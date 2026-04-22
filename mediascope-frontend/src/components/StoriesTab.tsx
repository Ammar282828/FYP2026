import React, { useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { API_BASE } from '../config';
import { useToast } from './ui/Toast';
import EmptyState from './ui/EmptyState';
import './StoriesTab.css';

const NARRATIVE_POLL_INTERVAL_MS = 3000;
const NARRATIVE_MAX_ATTEMPTS = 40; // 40 * 3s = 120s timeout

interface KeyEntity {
  text: string;
  type: string;
  article_count: number;
}

interface Story {
  id: string;
  title: string;
  topic_id: number;
  topic_label: string;
  article_count: number;
  start_date: string;
  end_date: string;
  date_span_days: number;
  key_entities: KeyEntity[];
  narrative: string | null;
  narrative_generated_at: string | null;
  avg_sentiment_score: number;
  dominant_sentiment: string;
  newspaper_ids: string[];
}

interface StoryArticle {
  id: string;
  headline: string;
  content: string;
  content_preview: string;
  publication_date: string;
  page_number: number;
  sentiment_label: string;
  sentiment_score: number;
}

interface RebuildStatus {
  running: boolean;
  started_at: string | null;
  finished_at: string | null;
  stories_created: number;
  last_error: string | null;
}

const RebuildStoriesButton: React.FC<{ onDone: () => void }> = ({ onDone }) => {
  const { toast } = useToast();
  const [status, setStatus] = useState<RebuildStatus | null>(null);
  const [open, setOpen] = useState(false);
  const [dateWindow, setDateWindow] = useState(30);
  const [jaccard, setJaccard] = useState(0.15);
  const [clear, setClear] = useState(true);
  const statusPoll = useRef<NodeJS.Timeout | null>(null);

  const pollStatus = useCallback(async () => {
    try {
      const resp = await axios.get(`${API_BASE}/stories/rebuild/status`);
      setStatus(resp.data);
      if (!resp.data.running) {
        if (statusPoll.current) { clearInterval(statusPoll.current); statusPoll.current = null; }
        if (resp.data.last_error) {
          toast(`Rebuild failed: ${resp.data.last_error.slice(0, 200)}`, 'error');
        } else if (resp.data.finished_at) {
          toast(`Rebuild complete — ${resp.data.stories_created} stories created`, 'success');
          onDone();
        }
      }
    } catch {
      /* keep trying */
    }
  }, [onDone, toast]);

  const start = async () => {
    try {
      await axios.post(`${API_BASE}/stories/rebuild`, {
        date_window: dateWindow,
        jaccard,
        clear,
      });
      toast('Rebuild started — this may take a few minutes', 'info');
      setOpen(false);
      statusPoll.current = setInterval(pollStatus, 4000);
      pollStatus();
    } catch (e: any) {
      toast(`Failed to start: ${e?.response?.data?.detail || e?.message}`, 'error');
    }
  };

  useEffect(() => {
    // Check status on mount in case a job is already running
    pollStatus();
    return () => {
      if (statusPoll.current) clearInterval(statusPoll.current);
    };
  }, [pollStatus]);

  const running = status?.running;

  return (
    <div style={{ marginTop: 8 }}>
      <button
        onClick={() => setOpen(true)}
        disabled={running}
        style={{
          padding: '6px 12px', fontSize: 12,
          background: running ? 'var(--text-tertiary)' : 'var(--primary-color)',
          color: 'white', border: 'none', borderRadius: 4,
          cursor: running ? 'not-allowed' : 'pointer', width: '100%',
        }}
      >
        {running ? '⏳ Rebuilding stories…' : '🔄 Rebuild Stories'}
      </button>
      {open && (
        <div
          onClick={() => setOpen(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--bg-primary)', border: '1px solid var(--border-color)',
              borderRadius: 8, padding: 20, width: 360,
            }}
          >
            <h3 style={{ marginTop: 0 }}>Rebuild Stories</h3>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
              Re-groups all articles into stories. Takes 1–5 minutes.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <label style={{ fontSize: 13 }}>
                Date window (days):
                <input
                  type="number"
                  value={dateWindow}
                  onChange={e => setDateWindow(parseInt(e.target.value) || 30)}
                  style={{ width: '100%', padding: 6, marginTop: 4, background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 4 }}
                />
              </label>
              <label style={{ fontSize: 13 }}>
                Jaccard threshold (0-1):
                <input
                  type="number"
                  step="0.05" min="0" max="1"
                  value={jaccard}
                  onChange={e => setJaccard(parseFloat(e.target.value) || 0.15)}
                  style={{ width: '100%', padding: 6, marginTop: 4, background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 4 }}
                />
              </label>
              <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
                <input type="checkbox" checked={clear} onChange={e => setClear(e.target.checked)} />
                Clear existing stories first
              </label>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setOpen(false)}
                style={{ padding: '6px 12px', background: 'transparent', color: 'var(--text-primary)', border: '1px solid var(--border-color)', borderRadius: 4, cursor: 'pointer' }}
              >
                Cancel
              </button>
              <button
                onClick={start}
                style={{ padding: '6px 12px', background: 'var(--primary-color)', color: 'white', border: 'none', borderRadius: 4, cursor: 'pointer' }}
              >
                Start
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const StoriesTab: React.FC = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [stories, setStories] = useState<Story[]>([]);
  const [selectedStory, setSelectedStory] = useState<Story | null>(null);
  const [storyArticles, setStoryArticles] = useState<StoryArticle[]>([]);
  const [loading, setLoading] = useState(false);
  const [articlesLoading, setArticlesLoading] = useState(false);
  const [narrativeLoading, setNarrativeLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const pollRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    loadStories();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const loadStories = async () => {
    setLoading(true);
    try {
      const response = await axios.get(`${API_BASE}/stories/`, { params: { limit: 100 } });
      setStories(response.data.stories || []);
    } catch (err) {
      console.error('Failed to load stories:', err);
    } finally {
      setLoading(false);
    }
  };

  const selectStory = async (story: Story) => {
    setSelectedStory(story);
    setStoryArticles([]);
    setArticlesLoading(true);
    if (pollRef.current) clearInterval(pollRef.current);
    try {
      const response = await axios.get(`${API_BASE}/stories/${story.id}/articles`);
      setStoryArticles(response.data.articles || []);
    } catch (err) {
      console.error('Failed to load story articles:', err);
    } finally {
      setArticlesLoading(false);
    }
  };

  const generateNarrative = async (force = false) => {
    if (!selectedStory) return;
    setNarrativeLoading(true);
    const storyId = selectedStory.id;
    if (pollRef.current) clearInterval(pollRef.current);
    try {
      await axios.post(`${API_BASE}/stories/generate`, {
        story_id: storyId,
        force
      });

      let attempts = 0;
      let consecutiveErrors = 0;

      // Poll until narrative appears, with timeout + error tracking
      pollRef.current = setInterval(async () => {
        attempts += 1;
        try {
          const resp = await axios.get(`${API_BASE}/stories/${storyId}`);
          consecutiveErrors = 0;
          const updated: Story = resp.data;
          if (updated.narrative) {
            setSelectedStory(prev => (prev && prev.id === updated.id ? updated : prev));
            setStories(prev => prev.map(s => s.id === updated.id ? updated : s));
            setNarrativeLoading(false);
            toast('Narrative generated successfully', 'success');
            if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
            return;
          }
        } catch (err) {
          consecutiveErrors += 1;
          if (consecutiveErrors >= 5) {
            setNarrativeLoading(false);
            toast('Lost connection while generating narrative', 'error');
            if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
            return;
          }
        }

        if (attempts >= NARRATIVE_MAX_ATTEMPTS) {
          setNarrativeLoading(false);
          toast('Narrative generation timed out. Please try again.', 'error');
          if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
        }
      }, NARRATIVE_POLL_INTERVAL_MS);
    } catch (err: any) {
      console.error('Failed to start narrative generation:', err);
      setNarrativeLoading(false);
      toast(`Failed to start narrative generation: ${err?.response?.data?.detail || err?.message || 'Unknown error'}`, 'error');
    }
  };

  const sentimentClass = (label: string) => {
    if (label === 'positive') return 'sentiment-positive';
    if (label === 'negative') return 'sentiment-negative';
    return 'sentiment-neutral';
  };

  const formatDate = (iso: string) => {
    if (!iso) return '';
    return iso.slice(0, 10);
  };

  const filteredStories = stories.filter(s => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      s.title.toLowerCase().includes(q) ||
      s.topic_label.toLowerCase().includes(q) ||
      s.key_entities.some(e => e.text.toLowerCase().includes(q))
    );
  });

  return (
    <div className="stories-tab">
      {/* ── Left panel: story list ── */}
      <div className="stories-sidebar">
        <div className="stories-sidebar-header">
          <h2>Ongoing Stories</h2>
          <input
            className="stories-search"
            type="text"
            placeholder="Search by title, topic, entity..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
          <RebuildStoriesButton onDone={loadStories} />
        </div>

        {loading ? (
          <div className="stories-loading">Loading stories...</div>
        ) : filteredStories.length === 0 ? (
          stories.length === 0 ? (
            <EmptyState
              icon={'\uD83D\uDCF0'}
              title="No stories yet"
              description="Run scripts/build_stories.py to cluster articles into ongoing stories."
            />
          ) : (
            <EmptyState
              icon={'\uD83D\uDD0D'}
              title="No stories match your search"
              description="Try a different keyword, topic, or entity name."
              action={{ label: 'Clear search', onClick: () => setSearchQuery('') }}
            />
          )
        ) : (
          <ul className="stories-list">
            {filteredStories.map(story => (
              <li
                key={story.id}
                className={`story-card ${selectedStory?.id === story.id ? 'story-card--active' : ''}`}
                onClick={() => selectStory(story)}
              >
                <div className="story-card-header">
                  <span className="story-card-title">{story.title}</span>
                  <span className={`story-badge ${sentimentClass(story.dominant_sentiment)}`}>
                    {story.dominant_sentiment}
                  </span>
                </div>
                <div className="story-card-meta">
                  <span>{formatDate(story.start_date)}</span>
                  {story.date_span_days > 0 && (
                    <span> → {formatDate(story.end_date)}</span>
                  )}
                </div>
                <div className="story-card-stats">
                  <span className="story-stat">{story.article_count} article{story.article_count !== 1 ? 's' : ''}</span>
                  {story.narrative && (
                    <span className="story-has-narrative">● Arc</span>
                  )}
                </div>
                <div className="story-entities">
                  {story.key_entities.slice(0, 3).map(e => (
                    <span key={e.text} className={`entity-chip entity-${e.type.toLowerCase()}`}>
                      {e.text}
                    </span>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ── Right panel: story detail ── */}
      <div className="stories-detail">
        {!selectedStory ? (
          <EmptyState
            icon={'\uD83D\uDCF0'}
            title="Pick a story"
            description="Select a story from the list to see its arc, key entities, and the articles behind it."
          />
        ) : (
          <>
            {/* Story header */}
            <div className="story-detail-header">
              <h2 className="story-detail-title">{selectedStory.title}</h2>
              <div className="story-detail-meta">
                <span className="story-detail-dates">
                  {formatDate(selectedStory.start_date)}
                  {selectedStory.date_span_days > 0 && ` → ${formatDate(selectedStory.end_date)}`}
                  {selectedStory.date_span_days > 0 && ` (${selectedStory.date_span_days} days)`}
                </span>
                <span className={`story-badge ${sentimentClass(selectedStory.dominant_sentiment)}`}>
                  {selectedStory.dominant_sentiment}
                </span>
                <span className="story-detail-topic">{selectedStory.topic_label}</span>
              </div>
              <div className="story-detail-entities">
                {selectedStory.key_entities.slice(0, 8).map(e => (
                  <span key={e.text} className={`entity-chip entity-chip--lg entity-${e.type.toLowerCase()}`}>
                    {e.text}
                    <span className="entity-count">{e.article_count}</span>
                  </span>
                ))}
              </div>
            </div>

            {/* Narrative section */}
            <div className="story-narrative-section">
              <div className="story-narrative-header">
                <h3>Story Arc</h3>
                <div className="story-narrative-actions">
                  {selectedStory.narrative && (
                    <button
                      className="btn-regenerate"
                      onClick={() => generateNarrative(true)}
                      disabled={narrativeLoading}
                    >
                      Regenerate
                    </button>
                  )}
                  {!selectedStory.narrative && (
                    <button
                      className="btn-generate"
                      onClick={() => generateNarrative(false)}
                      disabled={narrativeLoading || selectedStory.article_count < 2}
                      title={selectedStory.article_count < 2 ? 'Need at least 2 articles' : ''}
                    >
                      {narrativeLoading ? 'Generating...' : 'Generate Story Arc'}
                    </button>
                  )}
                </div>
              </div>

              {narrativeLoading && (
                <div className="narrative-loading">
                  <div className="narrative-spinner"></div>
                  <p>Gemini is writing the story arc… this may take 15–30 seconds.</p>
                </div>
              )}

              {selectedStory.narrative && !narrativeLoading && (
                <div className="narrative-text">
                  {selectedStory.narrative.split('\n\n').map((para, i) => (
                    <p key={i}>{para}</p>
                  ))}
                  {selectedStory.narrative_generated_at && (
                    <div className="narrative-generated-at">
                      Generated {formatDate(selectedStory.narrative_generated_at)}
                    </div>
                  )}
                </div>
              )}

              {!selectedStory.narrative && !narrativeLoading && (
                <div className="narrative-placeholder">
                  No narrative generated yet.
                </div>
              )}
            </div>

            {/* Article timeline */}
            <div className="story-timeline-section">
              <h3>Articles ({selectedStory.article_count})</h3>
              {articlesLoading ? (
                <div className="stories-loading">Loading articles...</div>
              ) : (
                <div className="story-timeline">
                  {storyArticles.map((article, idx) => (
                    <div key={article.id} className="timeline-item">
                      <div className="timeline-dot"></div>
                      <div
                        className="timeline-content timeline-content--clickable"
                        onClick={() => navigate(`/article/${article.id}`)}
                      >
                        <div className="timeline-date">{formatDate(article.publication_date)}</div>
                        <div className="timeline-headline">{article.headline || 'Untitled'}</div>
                        <div className="timeline-preview">{article.content_preview}</div>
                        <div className="timeline-footer">
                          <span className={`story-badge ${sentimentClass(article.sentiment_label)}`}>
                            {article.sentiment_label}
                          </span>
                          <span className="timeline-page">Page {article.page_number}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default StoriesTab;
