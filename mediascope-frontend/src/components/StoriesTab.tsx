import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import './StoriesTab.css';

const API_BASE = 'http://localhost:8000/api';

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

const StoriesTab: React.FC = () => {
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
    try {
      await axios.post(`${API_BASE}/stories/generate`, {
        story_id: selectedStory.id,
        force
      });
      // Poll until narrative appears
      pollRef.current = setInterval(async () => {
        try {
          const resp = await axios.get(`${API_BASE}/stories/${selectedStory.id}`);
          const updated: Story = resp.data;
          if (updated.narrative) {
            setSelectedStory(updated);
            setStories(prev => prev.map(s => s.id === updated.id ? updated : s));
            setNarrativeLoading(false);
            if (pollRef.current) clearInterval(pollRef.current);
          }
        } catch {/* keep polling */}
      }, 3000);
    } catch (err) {
      console.error('Failed to start narrative generation:', err);
      setNarrativeLoading(false);
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
          <h2>Stories</h2>
          <p className="stories-subtitle">Ongoing events traced across articles</p>
          <input
            className="stories-search"
            type="text"
            placeholder="Search by title, topic, entity..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
        </div>

        {loading ? (
          <div className="stories-loading">Loading stories...</div>
        ) : filteredStories.length === 0 ? (
          <div className="stories-empty">
            No stories found.{' '}
            {stories.length === 0
              ? 'Run scripts/build_stories.py to generate them.'
              : 'Try a different search term.'}
          </div>
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
          <div className="stories-detail-empty">
            <div className="stories-detail-empty-icon">📰</div>
            <p>Select a story to see its articles and generate a narrative arc.</p>
          </div>
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
                  {'Click "Generate Story Arc" to create an AI narrative tracing how this event developed over time.'}
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
                      <div className="timeline-content">
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
