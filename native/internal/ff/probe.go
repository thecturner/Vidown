package ff

import (
	"encoding/json"
	"os"
	"os/exec"
	"strings"
)

var ffmpegPath string
var ffprobePath string

// FFmpegInfo contains ffmpeg availability and version
type FFmpegInfo struct {
	Found   bool   `json:"found"`
	Version string `json:"version,omitempty"`
	Path    string `json:"path,omitempty"`
}

// ProbeFFmpeg checks if ffmpeg is available
func ProbeFFmpeg() FFmpegInfo {
	// Common installation paths (check these first)
	commonPaths := []string{
		"/usr/local/bin/ffmpeg",
		"/opt/homebrew/bin/ffmpeg",
		"/usr/bin/ffmpeg",
		"/opt/local/bin/ffmpeg",
	}

	// Try common paths first
	for _, path := range commonPaths {
		if _, err := os.Stat(path); err == nil {
			cmd := exec.Command(path, "-version")
			out, err := cmd.Output()
			if err == nil {
				ffmpegPath = path
				ffprobePath = strings.Replace(path, "ffmpeg", "ffprobe", 1)
				version := parseVersion(out)
				return FFmpegInfo{
					Found:   true,
					Version: version,
					Path:    path,
				}
			}
		}
	}

	// Fallback: try PATH
	cmd := exec.Command("ffmpeg", "-version")
	out, err := cmd.Output()
	if err != nil {
		return FFmpegInfo{Found: false}
	}

	ffmpegPath = "ffmpeg"
	ffprobePath = "ffprobe"
	version := parseVersion(out)
	return FFmpegInfo{
		Found:   true,
		Version: version,
		Path:    "ffmpeg (in PATH)",
	}
}

func parseVersion(out []byte) string {
	if len(out) == 0 {
		return "unknown"
	}
	lines := strings.Split(string(out), "\n")
	if len(lines) > 0 && len(lines[0]) > 7 {
		// Extract version from "ffmpeg version X.Y ..."
		parts := strings.Fields(lines[0])
		if len(parts) >= 3 {
			return parts[0] + " " + parts[1] + " " + parts[2]
		}
	}
	return "unknown"
}

// GetFFmpegPath returns the detected ffmpeg path
func GetFFmpegPath() string {
	if ffmpegPath == "" {
		return "ffmpeg"
	}
	return ffmpegPath
}

// GetFFprobePath returns the detected ffprobe path
func GetFFprobePath() string {
	if ffprobePath == "" {
		return "ffprobe"
	}
	return ffprobePath
}

// ProbeResult contains stream information
type ProbeResult struct {
	Format  ProbeFormat  `json:"format"`
	Streams []ProbeStream `json:"streams"`
}

type ProbeFormat struct {
	Duration string `json:"duration"`
	Size     string `json:"size"`
	BitRate  string `json:"bit_rate"`
}

type ProbeStream struct {
	CodecType string `json:"codec_type"`
	CodecName string `json:"codec_name"`
	Width     int    `json:"width,omitempty"`
	Height    int    `json:"height,omitempty"`
}

// ProbeURL uses ffprobe to get stream information
func ProbeURL(url string, headers map[string]string) (*ProbeResult, error) {
	args := []string{
		"-v", "quiet",
		"-print_format", "json",
		"-show_format",
		"-show_streams",
	}

	if len(headers) > 0 {
		args = append(args, "-headers", buildHeaderString(headers))
	}

	args = append(args, url)

	cmd := exec.Command(GetFFprobePath(), args...)
	out, err := cmd.Output()
	if err != nil {
		return nil, err
	}

	var result ProbeResult
	if err := json.Unmarshal(out, &result); err != nil {
		return nil, err
	}

	return &result, nil
}

func buildHeaderString(headers map[string]string) string {
	var result string
	for k, v := range headers {
		if result != "" {
			result += "\r\n"
		}
		result += k + ": " + v
	}
	result += "\r\n"
	return result
}
