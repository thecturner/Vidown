package ff

import (
	"encoding/json"
	"os/exec"
)

// FFmpegInfo contains ffmpeg availability and version
type FFmpegInfo struct {
	Found   bool   `json:"found"`
	Version string `json:"version,omitempty"`
}

// ProbeFFmpeg checks if ffmpeg is available
func ProbeFFmpeg() FFmpegInfo {
	cmd := exec.Command("ffmpeg", "-version")
	out, err := cmd.Output()
	if err != nil {
		return FFmpegInfo{Found: false}
	}

	// Parse first line for version
	version := "unknown"
	if len(out) > 0 {
		lines := string(out)
		if len(lines) > 15 {
			version = lines[:15] // "ffmpeg version X.Y"
		}
	}

	return FFmpegInfo{
		Found:   true,
		Version: version,
	}
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

	cmd := exec.Command("ffprobe", args...)
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
