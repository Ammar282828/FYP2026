import React, { useState, useRef, useEffect } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { MessageSquare, ArrowRight, FileText } from 'lucide-react';
import { API_BASE } from '../config';
import { useToast } from './ui/Toast';
import './ChatTab.css';

interface Source {
  id: string;
  headline: string;
  publication_date: string;
  citation_index: number;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  sources?: Source[];
}

const SAMPLE_QUESTIONS = [
  'What happened during the 1990 election?',
  'Who was Benazir Bhutto?',
  'What were the major political events in Pakistan in 1991?',
  'Tell me about the Gulf War coverage.',
];

const ChatTab: React.FC = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const sendQuestion = async (question: string) => {
    const q = question.trim();
    if (!q || loading) return;

    setMessages(prev => [...prev, { role: 'user', content: q }]);
    setInput('');
    setLoading(true);

    try {
      const response = await axios.post(`${API_BASE}/chat/ask`, {
        question: q,
        max_context: 6,
      });
      const { answer, sources } = response.data;
      setMessages(prev => [
        ...prev,
        { role: 'assistant', content: answer || '', sources: sources || [] },
      ]);
    } catch (err) {
      console.error('Chat error:', err);
      toast('Failed to get answer', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendQuestion(input);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendQuestion(input);
    }
  };

  const goToArticle = (id: string) => {
    navigate(`/article/${id}`);
  };

  // Render assistant content with citation markers [1], [2], etc.
  // as clickable chips that navigate to the referenced source.
  const renderAssistantContent = (content: string, sources?: Source[]) => {
    if (!content) return null;
    const sourceMap = new Map<number, Source>();
    (sources || []).forEach(s => sourceMap.set(s.citation_index, s));

    const parts: React.ReactNode[] = [];
    const regex = /\[(\d+)\]/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    let key = 0;

    while ((match = regex.exec(content)) !== null) {
      const idx = match.index;
      if (idx > lastIndex) {
        parts.push(
          <span key={`t-${key++}`}>{content.slice(lastIndex, idx)}</span>
        );
      }
      const num = parseInt(match[1], 10);
      const src = sourceMap.get(num);
      parts.push(
        <button
          key={`c-${key++}`}
          type="button"
          className="citation-chip"
          title={src ? `${src.headline} - ${src.publication_date}` : `Source ${num}`}
          onClick={() => src && goToArticle(src.id)}
          disabled={!src}
        >
          {num}
        </button>
      );
      lastIndex = idx + match[0].length;
    }
    if (lastIndex < content.length) {
      parts.push(<span key={`t-${key++}`}>{content.slice(lastIndex)}</span>);
    }
    return parts;
  };

  const formatDate = (d: string) => {
    if (!d) return '';
    try {
      return new Date(d).toLocaleDateString();
    } catch {
      return d;
    }
  };

  return (
    <div className="chat-tab">
      <div className="chat-header">
        <div className="section-eyebrow">Ask the Archive</div>
        <h2>What do you want to know about Dawn, 1990–1992?</h2>
        <p className="tagline">
          Every answer is grounded in source articles, with inline citations you can open.
        </p>
      </div>

      <div className="chat-messages">
        {messages.length === 0 && !loading && (
          <div className="chat-empty-state">
            <div className="empty-state__icon">
              <MessageSquare size={28} strokeWidth={1.5} />
            </div>
            <div className="empty-hint-title">Try one of these</div>
            <div className="sample-questions">
              {SAMPLE_QUESTIONS.map(q => (
                <button
                  key={q}
                  type="button"
                  className="sample-question"
                  onClick={() => sendQuestion(q)}
                >
                  <ArrowRight size={14} aria-hidden="true" />
                  <span>{q}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div
            key={i}
            className={`chat-message chat-message-${msg.role}`}
          >
            <div className="chat-bubble">
              {msg.role === 'assistant'
                ? renderAssistantContent(msg.content, msg.sources)
                : msg.content}
            </div>
            {msg.role === 'assistant' && msg.sources && msg.sources.length > 0 && (
              <div className="chat-sources">
                <div className="chat-sources-title">Sources</div>
                <div className="chat-sources-list">
                  {msg.sources.map(s => (
                    <button
                      key={`${s.id}-${s.citation_index}`}
                      type="button"
                      className="source-card"
                      onClick={() => goToArticle(s.id)}
                    >
                      <FileText size={14} aria-hidden="true" />
                      <span className="source-index">[{s.citation_index}]</span>
                      <span className="source-headline">{s.headline}</span>
                      <span className="source-date">
                        {formatDate(s.publication_date)}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}

        {loading && (
          <div className="chat-message chat-message-assistant">
            <div className="chat-bubble chat-thinking">
              <span className="thinking-dot"></span>
              <span className="thinking-dot"></span>
              <span className="thinking-dot"></span>
              <span className="thinking-text">Reading the archive…</span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <form className="chat-input-bar" onSubmit={handleSubmit}>
        <textarea
          className="chat-input"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask anything about the archive..."
          rows={1}
          disabled={loading}
        />
        <button
          type="submit"
          className="chat-send-btn"
          disabled={loading || !input.trim()}
        >
          Send
        </button>
      </form>
    </div>
  );
};

export default ChatTab;
