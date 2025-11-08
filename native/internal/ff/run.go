package ff

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"os/exec"
	"strconv"
	"strings"
	"time"
)

// ProgressUpdate contains ffmpeg progress information
type ProgressUpdate struct {
	BytesWritten int64
	OutTimeMs    int64
	Speed        float64
	Frame        int64
}

// ProgressCallback is called with progress updates
type ProgressCallback func(ProgressUpdate)

// RunFFmpeg executes ffmpeg with progress monitoring
func RunFFmpeg(ctx context.Context, args []string, onProgress ProgressCallback) error {
	// Prepend standard args
	fullArgs := []string{
		"-y",                  // overwrite
		"-v", "error",         // only show errors
		"-nostats",            // no stats
		"-progress", "pipe:1", // progress to stdout
	}
	fullArgs = append(fullArgs, args...)

	cmd := exec.CommandContext(ctx, "ffmpeg", fullArgs...)

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}

	stderr, err := cmd.StderrPipe()
	if err != nil {
		return err
	}

	if err := cmd.Start(); err != nil {
		return err
	}

	// Parse progress from stdout
	go parseProgress(stdout, onProgress)

	// Log stderr
	go logStderr(stderr)

	return cmd.Wait()
}

func parseProgress(r io.Reader, onProgress ProgressCallback) {
	scanner := bufio.NewScanner(r)
	var update ProgressUpdate

	for scanner.Scan() {
		line := scanner.Text()
		if line == "" {
			continue
		}

		// Parse key=value
		parts := strings.SplitN(line, "=", 2)
		if len(parts) != 2 {
			continue
		}

		key := parts[0]
		value := parts[1]

		switch key {
		case "total_size":
			if n, err := strconv.ParseInt(value, 10, 64); err == nil {
				update.BytesWritten = n
			}
		case "out_time_ms":
			if n, err := strconv.ParseInt(value, 10, 64); err == nil {
				update.OutTimeMs = n
			}
		case "frame":
			if n, err := strconv.ParseInt(value, 10, 64); err == nil {
				update.Frame = n
			}
		case "speed":
			// Remove 'x' suffix
			value = strings.TrimSuffix(value, "x")
			if f, err := strconv.ParseFloat(value, 64); err == nil {
				update.Speed = f
			}
		case "progress":
			// End of progress block, send update
			if onProgress != nil {
				onProgress(update)
			}
		}
	}
}

func logStderr(r io.Reader) {
	scanner := bufio.NewScanner(r)
	for scanner.Scan() {
		// Could log to stderr or send to extension
		// For now just consume it
		_ = scanner.Text()
	}
}

// BuildHLSArgs constructs ffmpeg args for HLS download
func BuildHLSArgs(url, output string, headers map[string]string) []string {
	args := []string{
		"-user_agent", "Vidown/1.0 (Native Companion)",
		"-protocol_whitelist", "file,crypto,httpproxy,http,https,tcp,tls",
	}

	if len(headers) > 0 {
		args = append(args, "-headers", buildHeaderString(headers))
	}

	args = append(args,
		"-i", url,
		"-c:v", "copy",
		"-c:a", "copy",
		"-movflags", "+faststart",
		output,
	)

	return args
}

// BuildDASHArgs constructs ffmpeg args for DASH download
func BuildDASHArgs(url, output string, headers map[string]string) []string {
	args := []string{
		"-user_agent", "Vidown/1.0 (Native Companion)",
	}

	if len(headers) > 0 {
		args = append(args, "-headers", buildHeaderString(headers))
	}

	args = append(args,
		"-i", url,
		"-c:v", "copy",
		"-c:a", "copy",
		"-movflags", "+faststart",
		output,
	)

	return args
}

// BuildConvertArgs constructs ffmpeg args for conversion
func BuildConvertArgs(input, output string, vcodec, acodec string) []string {
	args := []string{"-i", input}

	// Video codec
	switch vcodec {
	case "copy":
		args = append(args, "-c:v", "copy")
	case "h264":
		args = append(args, "-c:v", "libx264", "-crf", "23", "-preset", "medium")
	case "hevc":
		args = append(args, "-c:v", "libx265", "-crf", "28", "-preset", "medium")
	default:
		args = append(args, "-c:v", "copy")
	}

	// Audio codec
	switch acodec {
	case "copy":
		args = append(args, "-c:a", "copy")
	case "aac":
		args = append(args, "-c:a", "aac", "-b:a", "128k")
	case "opus":
		args = append(args, "-c:a", "libopus", "-b:a", "128k")
	case "mp3":
		args = append(args, "-c:a", "libmp3lame", "-b:a", "192k")
	default:
		args = append(args, "-c:a", "copy")
	}

	args = append(args, "-movflags", "+faststart", output)

	return args
}

// EstimateDuration tries to get duration from time-based progress
func EstimateDuration(url string, headers map[string]string) (time.Duration, error) {
	result, err := ProbeURL(url, headers)
	if err != nil {
		return 0, err
	}

	if result.Format.Duration == "" {
		return 0, fmt.Errorf("no duration found")
	}

	seconds, err := strconv.ParseFloat(result.Format.Duration, 64)
	if err != nil {
		return 0, err
	}

	return time.Duration(seconds * float64(time.Second)), nil
}
