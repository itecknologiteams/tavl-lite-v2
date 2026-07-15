import React, { useEffect, useState } from 'react';
import { adminApi, reloadFs } from '../stores/adminAuthStore';
import {
  Code, FileCode, Play, Save, Trash2, Plus, RefreshCw,
  CheckCircle, XCircle, Terminal, Copy, Download
} from 'lucide-react';

interface Script {
  name: string;
  type: 'lua' | 'javascript' | 'python' | 'perl';
  content: string;
  description?: string;
  enabled: boolean;
  lastModified?: string;
  size?: number;
}

const SCRIPT_TEMPLATES = {
  lua: `-- FreeSWITCH Lua Script: {name}
-- Description: {description}

-- Get session variables
local session = argv[1] and freeswitch.Session(argv[1]) or nil
if not session then
    freeswitch.consoleLog("ERR", "No session provided\\n")
    return
end

-- Answer the call
session:answer()

-- Play a greeting
session:execute("playback", "/usr/share/freeswitch/sounds/en/us/callie/ivr/ivr-welcome.wav")

-- Get user input
local digits = session:playAndGetDigits(1, 10, 3, 5000, "#",
    "/usr/share/freeswitch/sounds/en/us/callie/ivr/ivr-enter_ext.wav",
    "/usr/share/freeswitch/sounds/en/us/callie/ivr/ivr-that_was_an_invalid_entry.wav",
    "\\d+", "digits")

freeswitch.consoleLog("INFO", "User entered: " .. digits .. "\\n")

-- Transfer based on input
if digits == "1" then
    session:execute("transfer", "100 XML default")
elseif digits == "2" then
    session:execute("transfer", "sales-queue XML default")
else
    session:execute("playback", "/usr/share/freeswitch/sounds/en/us/callie/ivr/ivr-thank_you.wav")
end

-- Hangup
session:hangup()
`,
  javascript: `// FreeSWITCH JavaScript Script: {name}
// Description: {description}

// Get session
var session = new Session(argv[0]);
if (!session) {
    console_log("ERR", "No session provided\\n");
    exit();
}

// Answer the call
session.answer();

// Log call information
console_log("INFO", "Call from " + session.caller_id_number + " to " + session.destination_number + "\\n");

// Play greeting
session.execute("playback", "/usr/share/freeswitch/sounds/en/us/callie/ivr/ivr-welcome.wav");

// Bridge to extension
session.execute("bridge", "user/100@" + session.getVariable("domain_name"));

// Hangup
session.hangup();
`,
  python: `# FreeSWITCH Python Script: {name}
# Description: {description}

import freeswitch

def handler(session, args):
    """Main handler function"""
    freeswitch.consoleLog("INFO", "Python script started\\n")
    
    # Answer the call
    session.answer()
    
    # Get caller info
    caller = session.getVariable("caller_id_number")
    freeswitch.consoleLog("INFO", f"Call from: {caller}\\n")
    
    # Play greeting
    session.execute("playback", "/usr/share/freeswitch/sounds/en/us/callie/ivr/ivr-welcome.wav")
    
    # Execute application
    session.execute("sleep", "1000")
    
    # Hangup
    session.hangup()

def fsapi(session, stream, env, args):
    """API handler for fs_cli"""
    stream.write("Python script executed successfully\\n")
`,
  perl: `# FreeSWITCH Perl Script: {name}
# Description: {description}

use strict;
use warnings;
use FS::Session;

# Get session
my $session = FS::Session->new();
if (!$session) {
    print STDERR "No session provided\\n";
    exit(1);
}

# Answer the call
$session->answer();

# Play greeting
$session->execute("playback", "/usr/share/freeswitch/sounds/en/us/callie/ivr/ivr-welcome.wav");

# Log info
$session->console_log("INFO", "Perl script executed\\n");

# Hangup
$session->hangup();
`,
};

export function ScriptsPage() {
  const [scripts, setScripts] = useState<Script[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedScript, setSelectedScript] = useState<Script | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [content, setContent] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [newScript, setNewScript] = useState({
    name: '',
    type: 'lua' as Script['type'],
    description: '',
  });
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(null), 4000);
      return () => clearTimeout(t);
    }
  }, [toast]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await adminApi('/scripts');
      const data = await res.json();
      if (data.success) setScripts(data.scripts);
    } catch (err) {
      console.error('Failed to fetch scripts:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!selectedScript) return;
    try {
      const res = await adminApi(`/scripts/${selectedScript.name}`, {
        method: 'PUT',
        body: JSON.stringify({ content })
      });
      const data = await res.json();
      if (data.success) {
        setToast({ type: 'success', message: 'Script saved' });
        await reloadFs();
        setIsEditing(false);
        fetchData();
      } else {
        setToast({ type: 'error', message: data.error || 'Failed to save' });
      }
    } catch {
      setToast({ type: 'error', message: 'Failed to save script' });
    }
  };

  const handleCreate = async () => {
    const template = SCRIPT_TEMPLATES[newScript.type]
      .replace('{name}', newScript.name)
      .replace('{description}', newScript.description);

    try {
      const res = await adminApi('/scripts', {
        method: 'POST',
        body: JSON.stringify({
          ...newScript,
          content: template,
          enabled: true,
        })
      });
      const data = await res.json();
      if (data.success) {
        setToast({ type: 'success', message: 'Script created' });
        await reloadFs();
        setShowAdd(false);
        setNewScript({ name: '', type: 'lua', description: '' });
        fetchData();
      } else {
        setToast({ type: 'error', message: data.error || 'Failed to create' });
      }
    } catch {
      setToast({ type: 'error', message: 'Failed to create script' });
    }
  };

  const handleDelete = async (name: string) => {
    if (!confirm(`Delete script "${name}"?`)) return;
    try {
      const res = await adminApi(`/scripts/${name}`, { method: 'DELETE' });
      if (res.ok) {
        setToast({ type: 'success', message: 'Script deleted' });
        await reloadFs();
        if (selectedScript?.name === name) {
          setSelectedScript(null);
          setContent('');
        }
        fetchData();
      }
    } catch {
      setToast({ type: 'error', message: 'Failed to delete' });
    }
  };

  const handleTest = async (name: string) => {
    try {
      const res = await adminApi(`/scripts/${name}/test`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setToast({ type: 'success', message: `Script test: ${data.output}` });
      } else {
        setToast({ type: 'error', message: `Script error: ${data.error}` });
      }
    } catch {
      setToast({ type: 'error', message: 'Failed to test script' });
    }
  };

  const getLanguageIcon = (type: string) => {
    switch (type) {
      case 'lua': return '🌙';
      case 'javascript': return '📜';
      case 'python': return '🐍';
      case 'perl': return '🐪';
      default: return '📄';
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin mx-auto mb-3" />
          <p className="text-slate-500 text-sm">Loading scripts...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-8rem)] flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <Code className="w-6 h-6 text-emerald-400" />
            Scripts
          </h1>
          <p className="text-slate-400 text-sm mt-1">Manage FreeSWITCH Lua, JavaScript, and Python scripts</p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={fetchData}
            className="p-2 bg-slate-700 hover:bg-slate-600 text-slate-400 hover:text-white rounded-lg transition-all">
            <RefreshCw className="w-4 h-4" />
          </button>
          <button onClick={() => setShowAdd(true)}
            className="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg text-sm flex items-center gap-2">
            <Plus className="w-4 h-4" />
            New Script
          </button>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div className={`p-3 rounded-xl flex items-center gap-2 mb-4 ${
          toast.type === 'success' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
          'bg-red-500/10 text-red-400 border border-red-500/20'
        }`}>
          {toast.type === 'success' ? <CheckCircle className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
          <span className="text-sm">{toast.message}</span>
        </div>
      )}

      {/* Add Script Modal */}
      {showAdd && (
        <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-6 mb-4">
          <h3 className="text-white font-medium mb-4 flex items-center gap-2">
            <FileCode className="w-5 h-5 text-emerald-400" />
            Create New Script
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Script Name</label>
              <input
                type="text"
                value={newScript.name}
                onChange={(e) => setNewScript({ ...newScript, name: e.target.value })}
                className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white text-sm"
                placeholder="e.g., custom-ivr"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Language</label>
              <select
                value={newScript.type}
                onChange={(e) => setNewScript({ ...newScript, type: e.target.value as any })}
                className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white text-sm"
              >
                <option value="lua">Lua (Recommended)</option>
                <option value="javascript">JavaScript</option>
                <option value="python">Python</option>
                <option value="perl">Perl</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Description</label>
              <input
                type="text"
                value={newScript.description}
                onChange={(e) => setNewScript({ ...newScript, description: e.target.value })}
                className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white text-sm"
                placeholder="Brief description"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setShowAdd(false)} className="px-4 py-2 text-slate-400 hover:text-white text-sm">
              Cancel
            </button>
            <button onClick={handleCreate}
              className="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg text-sm">
              Create Script
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 flex gap-4 min-h-0">
        {/* Script List */}
        <div className="w-64 flex-shrink-0 overflow-y-auto">
          <div className="space-y-2">
            {scripts.map((script) => (
              <button
                key={script.name}
                onClick={() => {
                  setSelectedScript(script);
                  setContent(script.content);
                  setIsEditing(false);
                }}
                className={`w-full text-left px-3 py-3 rounded-lg transition-all ${
                  selectedScript?.name === script.name
                    ? 'bg-emerald-500/20 border border-emerald-500/30'
                    : 'bg-slate-800 hover:bg-slate-700 border border-transparent'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-lg">{getLanguageIcon(script.type)}</span>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium truncate ${selectedScript?.name === script.name ? 'text-emerald-400' : 'text-white'}`}>
                      {script.name}
                    </p>
                    <p className="text-xs text-slate-500">.{script.type}</p>
                  </div>
                </div>
              </button>
            ))}

            {scripts.length === 0 && (
              <div className="text-center py-8 text-slate-500">
                <Code className="w-8 h-8 mx-auto mb-2 opacity-30" />
                <p className="text-sm">No scripts found</p>
              </div>
            )}
          </div>
        </div>

        {/* Editor */}
        <div className="flex-1 flex flex-col bg-slate-900 rounded-xl border border-slate-700 overflow-hidden">
          {selectedScript ? (
            <>
              {/* Toolbar */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700 bg-slate-800/50">
                <div className="flex items-center gap-3">
                  <span className="text-lg">{getLanguageIcon(selectedScript.type)}</span>
                  <div>
                    <p className="text-white font-medium">{selectedScript.name}.{selectedScript.type}</p>
                    <p className="text-xs text-slate-400">
                      {selectedScript.enabled ? 'Enabled' : 'Disabled'} • {selectedScript.size || 0} bytes
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => handleTest(selectedScript.name)}
                    className="p-2 text-slate-400 hover:text-emerald-400 hover:bg-slate-700 rounded-lg transition-all"
                    title="Test Script">
                    <Play className="w-4 h-4" />
                  </button>
                  <button onClick={() => setIsEditing(!isEditing)}
                    className={`p-2 rounded-lg transition-all ${isEditing ? 'text-emerald-400 bg-emerald-500/20' : 'text-slate-400 hover:text-white hover:bg-slate-700'}`}
                    title="Edit">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </button>
                  {isEditing && (
                    <button onClick={handleSave}
                      className="p-2 text-emerald-400 hover:bg-emerald-500/20 rounded-lg transition-all"
                      title="Save">
                      <Save className="w-4 h-4" />
                    </button>
                  )}
                  <button onClick={() => handleDelete(selectedScript.name)}
                    className="p-2 text-slate-400 hover:text-red-400 hover:bg-red-500/20 rounded-lg transition-all"
                    title="Delete">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Code Editor */}
              <div className="flex-1 relative">
                <textarea
                  value={content}
                  onChange={(e) => {
                    setContent(e.target.value);
                    if (!isEditing) setIsEditing(true);
                  }}
                  className="w-full h-full p-4 bg-slate-900 text-slate-300 font-mono text-sm resize-none focus:outline-none"
                  spellCheck={false}
                />
              </div>

              {/* Status Bar */}
              <div className="px-4 py-2 border-t border-slate-700 bg-slate-800/50 flex items-center justify-between text-xs text-slate-500">
                <div className="flex items-center gap-4">
                  <span>{selectedScript.type.toUpperCase()}</span>
                  <span>UTF-8</span>
                  <span>{content.split('\n').length} lines</span>
                </div>
                {isEditing && <span className="text-amber-400">Modified</span>}
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-slate-500">
              <div className="text-center">
                <Terminal className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p>Select a script to view or edit</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
