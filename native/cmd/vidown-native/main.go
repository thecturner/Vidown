package main

import (
	"bufio"
	"log"
	"os"
	"path/filepath"
	"runtime"

	"github.com/thecturner/vidown-native/internal/ff"
	"github.com/thecturner/vidown-native/internal/ipc"
	"github.com/thecturner/vidown-native/internal/job"
)

func main() {
	// Set up logging to stderr (stdout is used for Native Messaging)
	log.SetOutput(os.Stderr)
	log.SetFlags(log.Ldate | log.Ltime | log.Lshortfile)

	// Send hello message
	ffmpegInfo := ff.ProbeFFmpeg()
	if err := ipc.Send(ipc.Msg{
		"type":   "hello",
		"ok":     true,
		"ffmpeg": ffmpegInfo,
	}); err != nil {
		log.Fatal("Failed to send hello:", err)
	}

	// Create job manager
	jobManager := job.NewManager()

	// Read messages from stdin
	reader := bufio.NewReader(os.Stdin)

	for {
		msg, err := ipc.ReadMsg(reader)
		if err != nil {
			log.Println("Read error:", err)
			return
		}

		msgType := ipc.GetString(msg, "type")

		switch msgType {
		case "shutdown":
			return

		case "probe":
			handleProbe(msg)

		case "download":
			handleDownload(msg, jobManager)

		case "cancel":
			id := ipc.GetString(msg, "id")
			jobManager.Cancel(id)

		default:
			ipc.Send(ipc.Msg{
				"type":  "log",
				"level": "warn",
				"msg":   "unknown_command",
				"cmd":   msgType,
			})
		}
	}
}

func handleProbe(msg ipc.Msg) {
	url := ipc.GetString(msg, "url")
	headersMap := ipc.GetMap(msg, "headers")
	headers := ipc.GetStringMap(headersMap)

	result, err := ff.ProbeURL(url, headers)
	if err != nil {
		ipc.Send(ipc.Msg{
			"type":  "error",
			"code":  "probe_failed",
			"msg":   err.Error(),
			"url":   url,
		})
		return
	}

	ipc.Send(ipc.Msg{
		"type":   "probe-result",
		"url":    url,
		"result": result,
	})
}

func handleDownload(msg ipc.Msg, jobManager *job.Manager) {
	id := ipc.GetString(msg, "id")
	mode := ipc.GetString(msg, "mode")
	url := ipc.GetString(msg, "url")
	out := ipc.GetString(msg, "out")
	expTotal := ipc.GetInt64(msg, "expectedTotalBytes")

	headersMap := ipc.GetMap(msg, "headers")
	headers := ipc.GetStringMap(headersMap)

	convertMap := ipc.GetMap(msg, "convert")
	convert := job.ParseConvertOpts(convertMap)

	// If out is just a filename, prepend Downloads directory
	if !filepath.IsAbs(out) {
		downloadsDir := getDownloadsDir()
		out = filepath.Join(downloadsDir, out)
	}

	jobManager.Start(id, mode, url, out, headers, convert, expTotal)
}

func getDownloadsDir() string {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		homeDir = "."
	}

	// Platform-specific Downloads directory
	switch runtime.GOOS {
	case "windows":
		// Windows: %USERPROFILE%\Downloads
		return filepath.Join(homeDir, "Downloads")
	case "darwin":
		// macOS: ~/Downloads
		return filepath.Join(homeDir, "Downloads")
	case "linux":
		// Linux: ~/Downloads (or XDG_DOWNLOAD_DIR)
		xdgDownload := os.Getenv("XDG_DOWNLOAD_DIR")
		if xdgDownload != "" {
			return xdgDownload
		}
		return filepath.Join(homeDir, "Downloads")
	default:
		return filepath.Join(homeDir, "Downloads")
	}
}
