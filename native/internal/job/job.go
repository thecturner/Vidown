package job

import (
	"context"
	"fmt"
	"os"
	"sync"
	"time"

	"github.com/thecturner/vidown-native/internal/ff"
	"github.com/thecturner/vidown-native/internal/ipc"
)

// Job represents a download job
type Job struct {
	ID        string
	Mode      string
	URL       string
	Out       string
	Headers   map[string]string
	ExpTotal  int64
	Convert   *ConvertOpts

	speedEMA  float64
	lastBytes int64
	lastTick  time.Time
	cancel    context.CancelFunc
	mu        sync.Mutex
}

// ConvertOpts holds conversion options
type ConvertOpts struct {
	Container string
	VCodec    string
	ACodec    string
}

// Manager manages all jobs
type Manager struct {
	jobs map[string]*Job
	mu   sync.Mutex
}

// NewManager creates a new job manager
func NewManager() *Manager {
	return &Manager{
		jobs: make(map[string]*Job),
	}
}

// Start begins a new download job
func (m *Manager) Start(id, mode, url, out string, headers map[string]string, convert *ConvertOpts, expTotal int64) {
	m.mu.Lock()
	defer m.mu.Unlock()

	ctx, cancel := context.WithCancel(context.Background())

	job := &Job{
		ID:        id,
		Mode:      mode,
		URL:       url,
		Out:       out,
		Headers:   headers,
		ExpTotal:  expTotal,
		Convert:   convert,
		cancel:    cancel,
		lastTick:  time.Now(),
	}

	m.jobs[id] = job

	// Send job-started event
	ipc.Send(ipc.Msg{
		"type": "job-started",
		"id":   id,
		"out":  out,
	})

	go job.run(ctx)
}

// Cancel cancels a job
func (m *Manager) Cancel(id string) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if job, ok := m.jobs[id]; ok {
		job.cancel()
		delete(m.jobs, id)

		ipc.Send(ipc.Msg{
			"type": "canceled",
			"id":   id,
		})
	}
}

func (job *Job) run(ctx context.Context) {
	defer func() {
		if r := recover(); r != nil {
			ipc.Send(ipc.Msg{
				"type": "error",
				"id":   job.ID,
				"code": "panic",
				"msg":  fmt.Sprintf("%v", r),
			})
		}
	}()

	// Create temp file
	tmpOut := job.Out + ".part"

	var err error

	// Run download based on mode
	switch job.Mode {
	case "hls":
		err = job.downloadHLS(ctx, tmpOut)
	case "dash":
		err = job.downloadDASH(ctx, tmpOut)
	case "http":
		err = job.downloadHTTP(ctx, tmpOut)
	default:
		err = fmt.Errorf("unsupported mode: %s", job.Mode)
	}

	if err != nil {
		os.Remove(tmpOut)
		ipc.Send(ipc.Msg{
			"type": "error",
			"id":   job.ID,
			"code": "download_failed",
			"msg":  err.Error(),
		})
		return
	}

	// Convert if needed
	finalOut := job.Out
	if job.Convert != nil && job.Convert.Container != "copy" {
		convertedOut := tmpOut + ".converted"
		args := ff.BuildConvertArgs(tmpOut, convertedOut, job.Convert.VCodec, job.Convert.ACodec)

		err = ff.RunFFmpeg(ctx, args, func(update ff.ProgressUpdate) {
			job.sendProgress(update.BytesWritten, job.ExpTotal)
		})

		if err != nil {
			os.Remove(tmpOut)
			os.Remove(convertedOut)
			ipc.Send(ipc.Msg{
				"type": "error",
				"id":   job.ID,
				"code": "convert_failed",
				"msg":  err.Error(),
			})
			return
		}

		os.Remove(tmpOut)
		tmpOut = convertedOut
	}

	// Atomic rename
	if err := os.Rename(tmpOut, finalOut); err != nil {
		os.Remove(tmpOut)
		ipc.Send(ipc.Msg{
			"type": "error",
			"id":   job.ID,
			"code": "rename_failed",
			"msg":  err.Error(),
		})
		return
	}

	// Get final file size
	stat, _ := os.Stat(finalOut)
	var finalSize int64
	if stat != nil {
		finalSize = stat.Size()
	}

	// Send done
	ipc.Send(ipc.Msg{
		"type":         "done",
		"id":           job.ID,
		"final":        finalOut,
		"bytesWritten": finalSize,
	})
}

func (job *Job) downloadHLS(ctx context.Context, output string) error {
	args := ff.BuildHLSArgs(job.URL, output, job.Headers)

	return ff.RunFFmpeg(ctx, args, func(update ff.ProgressUpdate) {
		job.sendProgress(update.BytesWritten, job.ExpTotal)
	})
}

func (job *Job) downloadDASH(ctx context.Context, output string) error {
	args := ff.BuildDASHArgs(job.URL, output, job.Headers)

	return ff.RunFFmpeg(ctx, args, func(update ff.ProgressUpdate) {
		job.sendProgress(update.BytesWritten, job.ExpTotal)
	})
}

func (job *Job) downloadHTTP(ctx context.Context, output string) error {
	// For HTTP, just use ffmpeg to download (handles cookies/headers)
	args := []string{}

	if len(job.Headers) > 0 {
		headers := ""
		for k, v := range job.Headers {
			if headers != "" {
				headers += "\r\n"
			}
			headers += k + ": " + v
		}
		headers += "\r\n"
		args = append(args, "-headers", headers)
	}

	args = append(args,
		"-i", job.URL,
		"-c", "copy",
		output,
	)

	return ff.RunFFmpeg(ctx, args, func(update ff.ProgressUpdate) {
		job.sendProgress(update.BytesWritten, job.ExpTotal)
	})
}

func (job *Job) sendProgress(bytesReceived, totalBytes int64) {
	job.mu.Lock()
	defer job.mu.Unlock()

	now := time.Now()
	dt := now.Sub(job.lastTick).Seconds()

	if dt < 0.5 {
		// Don't send updates too frequently
		return
	}

	// Calculate speed with EMA
	dBytes := bytesReceived - job.lastBytes
	if dBytes < 0 {
		dBytes = 0
	}

	instSpeed := float64(dBytes) / dt
	if job.speedEMA == 0 {
		job.speedEMA = instSpeed
	} else {
		job.speedEMA = 0.25*instSpeed + 0.75*job.speedEMA
	}

	// Calculate ETA
	var etaSec int
	var percent int
	if totalBytes > 0 {
		remaining := totalBytes - bytesReceived
		if remaining < 0 {
			remaining = 0
		}
		if job.speedEMA > 0 {
			etaSec = int(float64(remaining) / job.speedEMA)
		}
		percent = int(float64(bytesReceived) * 100.0 / float64(totalBytes))
		if percent > 100 {
			percent = 100
		}
	}

	job.lastBytes = bytesReceived
	job.lastTick = now

	// Send progress event
	ipc.Send(ipc.Msg{
		"type":         "progress",
		"id":           job.ID,
		"bytesReceived": bytesReceived,
		"totalBytes":   totalBytes,
		"speedBps":     int64(job.speedEMA),
		"etaSec":       etaSec,
		"percent":      percent,
	})
}

// ParseConvertOpts extracts convert options from message
func ParseConvertOpts(m map[string]interface{}) *ConvertOpts {
	if m == nil {
		return nil
	}

	opts := &ConvertOpts{
		Container: "copy",
		VCodec:    "copy",
		ACodec:    "copy",
	}

	if v, ok := m["container"].(string); ok {
		opts.Container = v
	}
	if v, ok := m["vcodec"].(string); ok {
		opts.VCodec = v
	}
	if v, ok := m["acodec"].(string); ok {
		opts.ACodec = v
	}

	return opts
}
