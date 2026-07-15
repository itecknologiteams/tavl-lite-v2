import React, { useState, useRef, useCallback, KeyboardEvent } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getScripts, createScript, updateScript, deleteScript, testScript, extractError } from '../api';
import type { Script } from '../types';
import {
  Code, Trash2, Play, Loader2, AlertCircle, CheckCircle, XCircle,
  Plus, Save, Search, FileCode, X, Terminal,
} from 'lucide-react';

interface ToastItem { id: string; type: 'success' | 'error'; msg: string }
function usePageToast() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toast = (type: 'success' | 'error', msg: string) => {
    const id = Date.now().toString();
    setToasts((p) => [...p, { id, type, msg }]);
    setTimeout(() => setToasts((p) => p.filter((t) => t.id !== id)), type === 'success' ? 3000 : 5000);
  };
  return { toasts, toast };
}

function formatBytes(bytes?: number): string {
  if (!bytes) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

const LANGUAGES = [
  { value: 'lua', label: 'Lua' },
  { value: 'javascript', label: 'JavaScript' },
  { value: 'python', label: 'Python' },
  { value: 'perl', label: 'Perl' },
] as const;

type ViewMode = 'none' | 'new' | 'edit';

export function ScriptsPageV2() {
  const queryClient = useQueryClient();
  const { toasts, toast } = usePageToast();
  const [search, setSearch] = useState('');
  const [selectedScript, setSelectedScript] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('none');

  const [newName, setNewName] = useState('');
  const [newLanguage, setNewLanguage] = useState('lua');
  const [newDescription, setNewDescription] = useState('');
  const [newContent, setNewContent] = useState('');

  const [editContent, setEditContent] = useState('');
  const [testOutput, setTestOutput] = useState<{ success: boolean; output: string } | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const editorRef = useRef<HTMLTextAreaElement>(null);

  const { data: scripts = [], isLoading, isError } = useQuery<Script[]>({
    queryKey: ['scripts-v2'],
    queryFn: getScripts,
    staleTime: 30_000,
  });

  const createMut = useMutation({
    mutationFn: createScript,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scripts-v2'] });
      toast('success', 'Script created');
      setViewMode('none');
      setSelectedScript(null);
      setNewName('');
      setNewLanguage('lua');
      setNewDescription('');
      setNewContent('');
    },
    onError: (err) => toast('error', extractError(err)),
  });

  const updateMut = useMutation({
    mutationFn: ({ name, data }: { name: string; data: Partial<Script> }) => updateScript(name, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scripts-v2'] });
      toast('success', 'Script saved');
    },
    onError: (err) => toast('error', extractError(err)),
  });

  const deleteMut = useMutation({
    mutationFn: deleteScript,
    onSuccess: (_, name) => {
      queryClient.invalidateQueries({ queryKey: ['scripts-v2'] });
      toast('success', 'Script deleted');
      if (selectedScript === name) {
        setSelectedScript(null);
        setViewMode('none');
      }
      setDeleteConfirm(null);
    },
    onError: (err) => toast('error', extractError(err)),
  });

  const testMut = useMutation({
    mutationFn: testScript,
    onSuccess: (data) => {
      setTestOutput({
        success: !data.error,
        output: data.output || data.error || 'Script executed successfully',
      });
    },
    onError: (err) => {
      setTestOutput({ success: false, output: extractError(err) });
    },
  });

  const selectScript = useCallback((script: Script) => {
    setSelectedScript(script.name);
    setEditContent(script.content || '');
    setViewMode('edit');
    setTestOutput(null);
  }, []);

  const startNew = () => {
    setSelectedScript(null);
    setViewMode('new');
    setNewName('');
    setNewLanguage('lua');
    setNewDescription('');
    setNewContent('');
    setTestOutput(null);
  };

  const handleTabKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const ta = e.currentTarget;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const value = ta.value;
      const newValue = value.substring(0, start) + '  ' + value.substring(end);
      if (viewMode === 'new') {
        setNewContent(newValue);
      } else {
        setEditContent(newValue);
      }
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = start + 2;
      });
    }
  };

  const filtered = scripts.filter((s) =>
    !search ||
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    (s.description || '').toLowerCase().includes(search.toLowerCase()),
  );

  const currentScript = scripts.find((s) => s.name === selectedScript);

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-3xl font-bold text-white tracking-tight">Scripts</h1>
        <p className="text-slate-400 mt-1 font-medium">FreeSWITCH Lua, JavaScript, and ESL scripts</p>
      </div>

      {/* Delete Confirm Modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setDeleteConfirm(null)}>
          <div className="bg-slate-800 border border-slate-700/50 rounded-2xl shadow-2xl w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <div className="p-6 space-y-4">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-red-500/10 border border-red-500/20">
                  <Trash2 className="w-5 h-5 text-red-400" />
                </div>
                <div>
                  <h3 className="text-white font-bold">Delete Script</h3>
                  <p className="text-sm text-slate-400">
                    Delete <span className="font-mono text-white">{deleteConfirm}</span>?
                  </p>
                </div>
              </div>
              <p className="text-xs text-slate-500">This action cannot be undone.</p>
              <div className="flex justify-end gap-3">
                <button onClick={() => setDeleteConfirm(null)} className="px-4 py-2 text-sm font-semibold text-slate-400 hover:text-white transition-colors">
                  Cancel
                </button>
                <button
                  onClick={() => deleteMut.mutate(deleteConfirm)}
                  disabled={deleteMut.isPending}
                  className="flex items-center gap-2 bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20 px-3 py-1.5 rounded-lg text-sm font-semibold transition-all disabled:opacity-60"
                >
                  {deleteMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                  Delete
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {isLoading && (
        <div className="flex flex-col items-center justify-center p-20 bg-slate-800/50 backdrop-blur-xl rounded-2xl border border-slate-700/50">
          <Loader2 className="w-8 h-8 text-indigo-400 animate-spin mb-3" />
          <p className="text-slate-400 text-sm">Loading scripts…</p>
        </div>
      )}
      {isError && (
        <div className="flex flex-col items-center justify-center p-16 bg-slate-800/50 backdrop-blur-xl rounded-2xl border border-slate-700/50">
          <AlertCircle className="w-8 h-8 text-red-400 mb-3" />
          <p className="text-white font-semibold">Failed to load scripts</p>
        </div>
      )}

      {!isLoading && !isError && (
        <div className="flex gap-6 min-h-[600px]">
          {/* Left Panel — Script List */}
          <div className="w-80 flex-shrink-0 bg-slate-800/50 backdrop-blur-xl rounded-2xl border border-slate-700/50 flex flex-col overflow-hidden">
            <div className="p-4 border-b border-slate-700/40 space-y-3">
              <button
                onClick={startNew}
                className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-400 hover:to-purple-500 text-white font-semibold px-4 py-2 rounded-lg text-sm transition-all"
              >
                <Plus className="w-4 h-4" /> New Script
              </button>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
                <input
                  type="text"
                  placeholder="Search scripts…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full bg-slate-900/50 border border-slate-700 rounded-xl py-2 pl-8 pr-3 text-white text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 transition-all"
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto">
              {filtered.length === 0 && (
                <div className="flex flex-col items-center justify-center py-12 px-4">
                  <Code className="w-8 h-8 text-slate-600 mb-2" />
                  <p className="text-sm text-slate-500">{search ? 'No matches' : 'No scripts'}</p>
                </div>
              )}
              {filtered.map((script) => (
                <button
                  key={script.name}
                  onClick={() => selectScript(script)}
                  className={`w-full text-left px-4 py-3 border-b border-slate-700/20 hover:bg-slate-700/20 transition-colors ${
                    selectedScript === script.name && viewMode === 'edit' ? 'bg-slate-700/30 border-l-2 border-l-indigo-500' : ''
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <FileCode className="w-4 h-4 text-slate-500 flex-shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-white font-mono font-semibold truncate">{script.name}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700/50 text-slate-400 font-mono">{script.type}</span>
                        <span className="text-[10px] text-slate-600">{formatBytes(script.size)}</span>
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Right Panel — Editor */}
          <div className="flex-1 min-w-0 flex flex-col gap-4">
            {viewMode === 'none' && (
              <div className="flex-1 bg-slate-800/50 backdrop-blur-xl rounded-2xl border border-slate-700/50 flex flex-col items-center justify-center">
                <FileCode className="w-16 h-16 text-slate-600 mb-4" />
                <h3 className="text-lg font-semibold text-white mb-1">Select a Script</h3>
                <p className="text-sm text-slate-500 mb-4">Choose a script from the list or create a new one</p>
                <button
                  onClick={startNew}
                  className="flex items-center gap-2 bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-400 hover:to-purple-500 text-white font-semibold px-4 py-2 rounded-lg text-sm transition-all"
                >
                  <Plus className="w-4 h-4" /> Create New Script
                </button>
              </div>
            )}

            {/* New Script Form */}
            {viewMode === 'new' && (
              <>
                <div className="bg-slate-800/50 backdrop-blur-xl rounded-2xl border border-slate-700/50 p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-white uppercase tracking-wider">New Script</h3>
                    <button onClick={() => setViewMode('none')} className="text-slate-500 hover:text-slate-300">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">Name</label>
                      <input
                        type="text"
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        placeholder="my-script.lua"
                        className="w-full bg-slate-900/50 border border-slate-700 rounded-xl py-2.5 px-3 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 transition-all font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">Language</label>
                      <select
                        value={newLanguage}
                        onChange={(e) => setNewLanguage(e.target.value)}
                        className="w-full bg-slate-900/50 border border-slate-700 rounded-xl py-2.5 px-3 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 transition-all"
                      >
                        {LANGUAGES.map((l) => (
                          <option key={l.value} value={l.value}>{l.label}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">Description</label>
                      <input
                        type="text"
                        value={newDescription}
                        onChange={(e) => setNewDescription(e.target.value)}
                        placeholder="What this script does…"
                        className="w-full bg-slate-900/50 border border-slate-700 rounded-xl py-2.5 px-3 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 transition-all"
                      />
                    </div>
                  </div>
                </div>

                {/* Code Editor */}
                <div className="flex-1 bg-slate-800/50 backdrop-blur-xl rounded-2xl border border-slate-700/50 flex flex-col overflow-hidden">
                  <div className="px-4 py-2 border-b border-slate-700/40 flex items-center justify-between">
                    <span className="text-xs text-slate-500 font-mono">{newName || 'untitled'}</span>
                    <button
                      onClick={() => {
                        if (!newName.trim()) { toast('error', 'Script name is required'); return; }
                        createMut.mutate({
                          name: newName,
                          type: newLanguage,
                          description: newDescription || undefined,
                          content: newContent,
                        });
                      }}
                      disabled={!newName.trim() || createMut.isPending}
                      className="flex items-center gap-2 bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-400 hover:to-purple-500 text-white font-semibold px-3 py-1.5 rounded-lg text-xs transition-all disabled:opacity-60"
                    >
                      {createMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                      Save
                    </button>
                  </div>
                  <textarea
                    ref={editorRef}
                    value={newContent}
                    onChange={(e) => setNewContent(e.target.value)}
                    onKeyDown={handleTabKey}
                    placeholder="-- Enter your script code here…"
                    spellCheck={false}
                    className="flex-1 w-full bg-slate-900 p-4 text-sm text-slate-200 font-mono resize-none focus:outline-none"
                  />
                </div>
              </>
            )}

            {/* Edit Script */}
            {viewMode === 'edit' && currentScript && (
              <>
                <div className="bg-slate-800/50 backdrop-blur-xl rounded-2xl border border-slate-700/50 p-5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <FileCode className="w-5 h-5 text-slate-400" />
                      <div>
                        <h3 className="text-base font-bold text-white font-mono">{currentScript.name}</h3>
                        <div className="flex items-center gap-3 mt-0.5">
                          <span className="text-xs px-2 py-0.5 rounded bg-slate-700/50 text-slate-400 font-mono">{currentScript.type}</span>
                          {currentScript.description && <span className="text-xs text-slate-500">{currentScript.description}</span>}
                          <span className="text-xs text-slate-600">{formatBytes(currentScript.size)}</span>
                          {currentScript.lastModified && (
                            <span className="text-xs text-slate-600">Modified: {new Date(currentScript.lastModified).toLocaleDateString()}</span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => testMut.mutate(currentScript.name)}
                        disabled={testMut.isPending}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20 transition-all disabled:opacity-60"
                      >
                        {testMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                        Test
                      </button>
                      <button
                        onClick={() => setDeleteConfirm(currentScript.name)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20 transition-all"
                      >
                        <Trash2 className="w-3.5 h-3.5" /> Delete
                      </button>
                    </div>
                  </div>
                </div>

                {/* Code Editor */}
                <div className="flex-1 bg-slate-800/50 backdrop-blur-xl rounded-2xl border border-slate-700/50 flex flex-col overflow-hidden">
                  <div className="px-4 py-2 border-b border-slate-700/40 flex items-center justify-between">
                    <span className="text-xs text-slate-500 font-mono">{currentScript.name}</span>
                    <button
                      onClick={() => updateMut.mutate({ name: currentScript.name, data: { content: editContent } })}
                      disabled={updateMut.isPending}
                      className="flex items-center gap-2 bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-400 hover:to-purple-500 text-white font-semibold px-3 py-1.5 rounded-lg text-xs transition-all disabled:opacity-60"
                    >
                      {updateMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                      Save
                    </button>
                  </div>
                  <textarea
                    ref={editorRef}
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    onKeyDown={handleTabKey}
                    spellCheck={false}
                    className="flex-1 w-full bg-slate-900 p-4 text-sm text-slate-200 font-mono resize-none focus:outline-none"
                  />
                </div>

                {/* Test Output */}
                {testOutput && (
                  <div className={`bg-slate-800/50 backdrop-blur-xl rounded-2xl border p-4 ${
                    testOutput.success ? 'border-emerald-500/20' : 'border-red-500/20'
                  }`}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <Terminal className={`w-4 h-4 ${testOutput.success ? 'text-emerald-400' : 'text-red-400'}`} />
                        <span className="text-xs font-bold text-white uppercase tracking-wider">Test Output</span>
                      </div>
                      <button onClick={() => setTestOutput(null)} className="text-xs text-slate-500 hover:text-slate-300">Dismiss</button>
                    </div>
                    <pre className={`text-xs font-mono rounded-xl p-3 overflow-auto max-h-40 whitespace-pre-wrap ${
                      testOutput.success ? 'bg-emerald-500/5 text-emerald-300' : 'bg-red-500/5 text-red-300'
                    }`}>
                      {testOutput.output}
                    </pre>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Toasts */}
      <div className="fixed bottom-6 right-6 z-50 space-y-3 pointer-events-none">
        {toasts.map((t) => (
          <div key={t.id} className={`flex items-center gap-3 px-4 py-3 rounded-xl backdrop-blur-xl border animate-fade-in shadow-lg pointer-events-auto max-w-sm ${t.type === 'success' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : 'bg-red-500/10 border-red-500/30 text-red-400'}`}>
            {t.type === 'success' ? <CheckCircle className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
            <span className="text-sm font-medium">{t.msg}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
