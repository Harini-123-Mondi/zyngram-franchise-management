import React, { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';

function ZynpiChat({ user, onClose }) {
  const [activeMode, setActiveMode] = useState('assistant');
  const [messages, setMessages] = useState([]);
  const [assistantMessages, setAssistantMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const messageListRef = useRef(null);

  const fetchMessages = useCallback(async (isInitialLoad = false) => {
    try {
      const token = localStorage.getItem('token');
      const response = await axios.get('/api/chat/messages', {
        headers: { Authorization: `Bearer ${token}` }
      });
      setMessages(response.data);
      if (isInitialLoad) setError('');
    } catch (requestError) {
      setError(requestError.response?.data?.error || 'Zynpi messages could not be loaded.');
    } finally {
      if (isInitialLoad) setLoading(false);
    }
  }, []);

  const fetchAssistantMessages = useCallback(async (isInitialLoad = false) => {
    try {
      const token = localStorage.getItem('token');
      const response = await axios.get('/api/chat/assistant/messages', {
        headers: { Authorization: `Bearer ${token}` }
      });
      setAssistantMessages(response.data);
      if (isInitialLoad) setError('');
    } catch (requestError) {
      setError(requestError.response?.data?.error || 'Zynpi AI conversation could not be loaded.');
    } finally {
      if (isInitialLoad) setLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    const refreshMessages = activeMode === 'assistant' ? fetchAssistantMessages : fetchMessages;
    refreshMessages(true);
    const pollId = window.setInterval(() => refreshMessages(), 5000);
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      window.clearInterval(pollId);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [activeMode, fetchAssistantMessages, fetchMessages, onClose]);

  useEffect(() => {
    const messageList = messageListRef.current;
    if (messageList) messageList.scrollTop = messageList.scrollHeight;
  }, [activeMode, assistantMessages, messages]);

  const sendTeamMessage = async (event) => {
    event.preventDefault();
    const message = draft.trim();
    if (!message || sending) return;

    setSending(true);
    setError('');
    try {
      const token = localStorage.getItem('token');
      await axios.post('/api/chat/messages', { message }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setDraft('');
      await fetchMessages();
    } catch (requestError) {
      setError(requestError.response?.data?.error || 'Message could not be sent. Try again.');
    } finally {
      setSending(false);
    }
  };

  const sendMessage = async (event) => {
    event.preventDefault();
    const message = draft.trim();
    if (!message || sending) return;

    setSending(true);
    setError('');
    try {
      const token = localStorage.getItem('token');
      if (activeMode === 'assistant') {
        const response = await axios.post('/api/chat/assistant/messages', { message }, {
          headers: { Authorization: `Bearer ${token}` }
        });
        setAssistantMessages((currentMessages) => [...currentMessages, ...response.data.messages]);
      } else {
        await axios.post('/api/chat/messages', { message }, {
          headers: { Authorization: `Bearer ${token}` }
        });
        await fetchMessages();
      }
      setDraft('');
    } catch (requestError) {
      setError(requestError.response?.data?.error || 'Message could not be sent. Try again.');
    } finally {
      setSending(false);
    }
  };

  const handleComposerKeyDown = (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  };

  const visibleMessages = activeMode === 'assistant' ? assistantMessages : messages;

  return (
    <section className="zynpi-board" aria-labelledby="zynpi-title">
      <header className="zynpi-header">
        <div className="zynpi-brand">
          <span className="zynpi-orb" aria-hidden="true">Z</span>
          <div>
            <span className="zynpi-eyebrow">ZYNGRAM TEAM SPACE</span>
            <h2 id="zynpi-title">Zynpi</h2>
            <p>AI help and team chat in one place.</p>
          </div>
        </div>
        <div className="zynpi-header-actions">
          <span className="zynpi-presence">
            <i aria-hidden="true" /> {activeMode === 'assistant' ? 'AI assistant' : 'Internal team board'}
          </span>
          <button type="button" className="zynpi-close" onClick={onClose} aria-label="Close Zynpi chat">×</button>
        </div>
      </header>

      <div className="zynpi-conversation">
        <div className="zynpi-modes" role="tablist" aria-label="Zynpi chat type">
          <button
            type="button"
            role="tab"
            aria-selected={activeMode === 'assistant'}
            className={activeMode === 'assistant' ? 'active' : ''}
            onClick={() => { setActiveMode('assistant'); setError(''); }}
          >
            Zynpi AI
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeMode === 'team'}
            className={activeMode === 'team' ? 'active' : ''}
            onClick={() => { setActiveMode('team'); setError(''); }}
          >
            Team chat
          </button>
        </div>

        <div className="zynpi-board-intro">
          <span className="zynpi-intro-icon" aria-hidden="true">✦</span>
          <div>
            <strong>{activeMode === 'assistant' ? 'Ask Zynpi AI' : 'Welcome to team chat'}</strong>
            <p>
              {activeMode === 'assistant'
                ? 'Get help with franchise operations and using Zyngram.'
                : 'Share updates with HQ Admins and Franchise Owners.'}
            </p>
          </div>
        </div>

        <div className="zynpi-messages" ref={messageListRef} aria-live="polite" aria-relevant="additions">
          {loading ? (
            <p className="zynpi-empty">Loading {activeMode === 'assistant' ? 'Zynpi AI' : 'your team conversation'}…</p>
          ) : visibleMessages.length === 0 ? (
            <p className="zynpi-empty">
              {activeMode === 'assistant'
                ? 'Ask Zynpi AI about franchise operations or how to use the app.'
                : 'No team messages yet. Start the conversation below.'}
            </p>
          ) : visibleMessages.map((message) => {
            const isAssistant = activeMode === 'assistant' && message.role === 'assistant';
            const isMine = activeMode === 'assistant' ? message.role === 'user' : message.sender_id === user?.id;
            const senderName = isAssistant ? 'Zynpi AI' : (isMine ? 'You' : message.sender_name);
            const senderRole = isAssistant ? 'AI ASSISTANT' : (activeMode === 'assistant' ? user?.role : message.sender_role);
            return (
              <article
                className={`zynpi-message${isMine ? ' is-mine' : ''}${isAssistant ? ' is-assistant' : ''}`}
                key={message.id}
              >
                {!isMine && <span className="zynpi-avatar" aria-hidden="true">{isAssistant ? 'Z' : (message.sender_name?.charAt(0)?.toUpperCase() || '?')}</span>}
                <div className="zynpi-message-body">
                  <div className="zynpi-message-meta">
                    <strong>{senderName}</strong>
                    <span>{String(senderRole || '').replace(/_/g, ' ')}</span>
                    <time dateTime={message.created_at}>
                      {message.created_at
                        ? new Date(`${message.created_at.replace(' ', 'T')}Z`).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
                        : 'Now'}
                    </time>
                  </div>
                  <p>{message.message}</p>
                </div>
                {isMine && <span className="zynpi-avatar own" aria-hidden="true">{user?.name?.charAt(0)?.toUpperCase() || 'Y'}</span>}
              </article>
            );
          })}
        </div>

        {error && <div className="error zynpi-error" role="alert">{error}</div>}

        <form className="zynpi-composer" onSubmit={sendMessage}>
          <label className="visually-hidden" htmlFor="zynpi-message">
            {activeMode === 'assistant' ? 'Ask Zynpi AI' : 'Write a message to the team'}
          </label>
          <textarea
            id="zynpi-message"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={handleComposerKeyDown}
            maxLength={2000}
            placeholder={activeMode === 'assistant' ? 'Ask Zynpi AI…' : 'Write a message…'}
            rows={2}
            disabled={sending}
          />
          <div className="zynpi-composer-footer">
            <span>Enter to send · Shift + Enter for a new line · {draft.length}/2000</span>
            <button type="submit" disabled={sending || !draft.trim()}>
              {sending ? (activeMode === 'assistant' ? 'Thinking…' : 'Sending…') : (activeMode === 'assistant' ? 'Ask Zynpi' : 'Send message')}
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}

export default ZynpiChat;
