import { useState, useRef, useCallback, useEffect } from 'react';
import { Play, Square, Upload, Loader2, Music } from 'lucide-react';

interface AudioPickerProps {
  value: string;
  onChange: (value: string) => void;
  recordings: { id?: string; name: string; filename: string }[];
  label?: string;
  tip?: string;
  placeholder?: string;
  allowUpload?: boolean;
  allowNone?: boolean;
  onUploadComplete?: () => void;
  token?: string;
}

export function AudioPicker({
  value,
  onChange,
  recordings,
  label = 'Audio File',
  tip,
  placeholder = 'Select a recording…',
  allowUpload = true,
  allowNone = true,
  onUploadComplete,
  token,
}: AudioPickerProps) {
  const [playing, setPlaying] = useState(false);
  const [uploading, setUploading] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const blobUrlRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const cleanup = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }
    setPlaying(false);
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const handlePlay = useCallback(async () => {
    if (playing) {
      cleanup();
      return;
    }

    if (!value) return;

    try {
      const res = await fetch(`/api/pbx-admin/recordings/${encodeURIComponent(value)}/play`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error('Failed to fetch audio');

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      blobUrlRef.current = url;

      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => {
        cleanup();
      };
      audio.play();
      setPlaying(true);
    } catch {
      cleanup();
    }
  }, [value, playing, token, cleanup]);

  const handleUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const nameWithoutExt = file.name.replace(/\.[^/.]+$/, '');

      const form = new FormData();
      form.append('name', nameWithoutExt);
      form.append('file', file);

      setUploading(true);
      try {
        const res = await fetch('/api/pbx-admin/recordings/upload', {
          method: 'POST',
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          body: form,
        });
        if (!res.ok) throw new Error('Upload failed');

        onUploadComplete?.();
        onChange(file.name);
      } catch {
        // upload failed silently
      } finally {
        setUploading(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    },
    [token, onUploadComplete, onChange],
  );

  const selectedRecording = recordings.find((r) => r.filename === value);

  return (
    <div>
      <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5 flex items-center gap-1.5">
        <Music className="w-3.5 h-3.5" />
        {label}
        {tip && (
          <span
            className="w-4 h-4 rounded-full bg-slate-700 text-slate-400 text-[10px] font-bold flex items-center justify-center cursor-help"
            title={tip}
          >
            ?
          </span>
        )}
      </label>

      <div className="flex items-center gap-2">
        <select
          value={value}
          onChange={(e) => {
            cleanup();
            onChange(e.target.value);
          }}
          className="flex-1 bg-slate-900/50 border border-slate-700 rounded-xl py-2.5 px-3 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
        >
          {!value && <option value="">{placeholder}</option>}
          {allowNone && <option value="">None / Silence</option>}
          {recordings.map((r) => (
            <option key={r.id ?? r.filename} value={r.filename}>
              {r.name}
            </option>
          ))}
        </select>

        <button
          type="button"
          disabled={!value}
          onClick={handlePlay}
          className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          title={playing ? 'Stop' : 'Preview'}
        >
          {playing ? <Square className="w-4 h-4" /> : <Play className="w-4 h-4" />}
        </button>

        {allowUpload && (
          <>
            <button
              type="button"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700 disabled:opacity-50 transition-colors"
              title="Upload recording"
            >
              {uploading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Upload className="w-4 h-4" />
              )}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*"
              className="hidden"
              onChange={handleUpload}
            />
          </>
        )}
      </div>

      {value && selectedRecording && (
        <p className="mt-1 text-xs text-slate-500 truncate">{selectedRecording.filename}</p>
      )}
    </div>
  );
}
