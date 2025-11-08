package ipc

import (
	"bufio"
	"encoding/binary"
	"encoding/json"
	"io"
	"os"
	"sync"
)

// Msg is a generic JSON message
type Msg map[string]interface{}

var sendMu sync.Mutex

// Send writes a length-prefixed JSON message to stdout
func Send(m Msg) error {
	sendMu.Lock()
	defer sendMu.Unlock()

	b, err := json.Marshal(m)
	if err != nil {
		return err
	}

	// 4-byte little-endian length prefix
	length := uint32(len(b))
	if err := binary.Write(os.Stdout, binary.LittleEndian, length); err != nil {
		return err
	}

	// JSON payload
	_, err = os.Stdout.Write(b)
	return err
}

// ReadMsg reads a length-prefixed JSON message from reader
func ReadMsg(r *bufio.Reader) (Msg, error) {
	// Read 4-byte length prefix
	var length uint32
	if err := binary.Read(r, binary.LittleEndian, &length); err != nil {
		return nil, err
	}

	// Read JSON payload
	buf := make([]byte, length)
	if _, err := io.ReadFull(r, buf); err != nil {
		return nil, err
	}

	var m Msg
	if err := json.Unmarshal(buf, &m); err != nil {
		return nil, err
	}

	return m, nil
}

// Helper functions for type conversion

func GetString(m Msg, key string) string {
	if v, ok := m[key]; ok {
		if s, ok := v.(string); ok {
			return s
		}
	}
	return ""
}

func GetInt64(m Msg, key string) int64 {
	if v, ok := m[key]; ok {
		switch n := v.(type) {
		case float64:
			return int64(n)
		case int64:
			return n
		case int:
			return int64(n)
		}
	}
	return 0
}

func GetMap(m Msg, key string) map[string]interface{} {
	if v, ok := m[key]; ok {
		if mm, ok := v.(map[string]interface{}); ok {
			return mm
		}
	}
	return make(map[string]interface{})
}

func GetStringMap(m map[string]interface{}) map[string]string {
	result := make(map[string]string)
	for k, v := range m {
		if s, ok := v.(string); ok {
			result[k] = s
		}
	}
	return result
}
