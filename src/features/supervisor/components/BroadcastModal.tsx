/**
 * Broadcast Modal Component
 * Allows supervisor to send messages to all agents
 */

import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  MessageSquare,
  X,
  Send,
  AlertTriangle,
  Info,
} from 'lucide-react';

interface BroadcastModalProps {
  onClose: () => void;
}

export function BroadcastModal({ onClose }: BroadcastModalProps) {
  const [message, setMessage] = useState('');
  const [priority, setPriority] = useState<'normal' | 'urgent'>('normal');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSend = async () => {
    if (!message.trim()) return;

    setSending(true);
    try {
      const response = await fetch('/api/supervisor/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, priority }),
      });

      if (response.ok) {
        setSent(true);
        setTimeout(() => {
          onClose();
        }, 1500);
      }
    } catch (error) {
      console.error('Failed to broadcast:', error);
    } finally {
      setSending(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="w-[480px] bg-slate-900 border border-white/10 rounded-xl shadow-xl overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-white/5">
          <div className="flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-violet-400" />
            <h3 className="text-lg font-semibold text-white">Broadcast Message</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        {sent ? (
          <div className="p-8 text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-emerald-500/20 flex items-center justify-center">
              <Send className="w-8 h-8 text-emerald-400" />
            </div>
            <h4 className="text-xl font-semibold text-white mb-2">Message Sent!</h4>
            <p className="text-slate-400">Your message has been broadcast to all online agents.</p>
          </div>
        ) : (
          <div className="p-4 space-y-4">
            {/* Priority Selection */}
            <div>
              <label className="block text-sm font-medium text-slate-400 mb-2">Priority</label>
              <div className="flex gap-2">
                <button
                  onClick={() => setPriority('normal')}
                  className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg transition-colors ${
                    priority === 'normal'
                      ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                      : 'bg-slate-800 text-slate-400 hover:text-white'
                  }`}
                >
                  <Info className="w-4 h-4" />
                  Normal
                </button>
                <button
                  onClick={() => setPriority('urgent')}
                  className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg transition-colors ${
                    priority === 'urgent'
                      ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                      : 'bg-slate-800 text-slate-400 hover:text-white'
                  }`}
                >
                  <AlertTriangle className="w-4 h-4" />
                  Urgent
                </button>
              </div>
            </div>

            {/* Message Input */}
            <div>
              <label className="block text-sm font-medium text-slate-400 mb-2">Message</label>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Type your message to all agents..."
                rows={4}
                className="w-full px-4 py-3 bg-slate-800 border border-white/10 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-violet-500/50 resize-none"
              />
            </div>

            {/* Preview */}
            {message && (
              <div className={`p-3 rounded-lg border ${
                priority === 'urgent' 
                  ? 'bg-red-500/10 border-red-500/20' 
                  : 'bg-blue-500/10 border-blue-500/20'
              }`}>
                <div className="flex items-center gap-2 mb-1">
                  {priority === 'urgent' ? (
                    <AlertTriangle className="w-4 h-4 text-red-400" />
                  ) : (
                    <Info className="w-4 h-4 text-blue-400" />
                  )}
                  <span className={`text-xs font-medium ${
                    priority === 'urgent' ? 'text-red-400' : 'text-blue-400'
                  }`}>
                    Preview
                  </span>
                </div>
                <p className="text-sm text-white">{message}</p>
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        {!sent && (
          <div className="flex items-center justify-end gap-3 px-4 py-3 border-t border-white/5">
            <button
              onClick={onClose}
              className="px-4 py-2 text-slate-400 hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSend}
              disabled={!message.trim() || sending}
              className="flex items-center gap-2 px-4 py-2 bg-violet-500 hover:bg-violet-600 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-lg transition-colors"
            >
              <Send className="w-4 h-4" />
              {sending ? 'Sending...' : 'Broadcast'}
            </button>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}
