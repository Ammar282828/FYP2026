import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import {
  User, Building2, Globe, Flag, Map, Calendar, CalendarDays,
  Pin, Sparkles, BarChart as BarChartIcon, Tag,
  type LucideIcon,
} from 'lucide-react';
import { API_BASE } from '../config';

// Entity type metadata. The Icon field is a Lucide component constructor
// — render with `<Icon size={16} />`. (Was emoji until we ripped them
// out — emoji-as-icon is the most obvious AI-generated-UI tell.)
interface EntityTypeMeta {
  label: string;
  description: string;
  Icon: LucideIcon;
  color: string;
}

const ENTITY_TYPE_INFO: Record<string, EntityTypeMeta> = {
  PERSON: { label: 'People',                   description: 'Individuals, historical figures, politicians, celebrities',  Icon: User,         color: '#3b82f6' },
  ORG:    { label: 'Organizations',            description: 'Companies, government bodies, institutions, political parties', Icon: Building2,    color: '#8b5cf6' },
  GPE:    { label: 'Locations (Geo-Political)', description: 'Cities, countries, states, regions with governments',         Icon: Globe,        color: '#10b981' },
  NORP:   { label: 'Nationalities & Groups',   description: 'Nationalities, religious groups, political affiliations',     Icon: Flag,         color: '#f59e0b' },
  LOC:    { label: 'Locations (Geographic)',   description: 'Mountains, rivers, non-political geographic features',        Icon: Map,          color: '#06b6d4' },
  EVENT:  { label: 'Events',                   description: 'Wars, sports events, conferences, historical events',         Icon: Calendar,     color: '#ef4444' },
  DATE:   { label: 'Dates',                    description: 'Specific dates or time periods',                              Icon: CalendarDays, color: '#6b7280' },
};

// Fallback when the entity type isn't in our taxonomy.
const FALLBACK_ENTITY_META: EntityTypeMeta = {
  label: 'Other',
  description: 'Entity type not in the standard taxonomy',
  Icon: Pin,
  color: '#6b7280',
};

const ALL_ENTITIES_META: EntityTypeMeta = {
  label: 'All Entities',
  description: 'Browse every entity type at once',
  Icon: Sparkles,
  color: '#6b7280',
};

// Interactive Keyword Component
export const InteractiveKeywords: React.FC = () => {
  const navigate = useNavigate();
  const [keywords, setKeywords] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedKeyword, setSelectedKeyword] = useState<any>(null);
  const [keywordArticles, setKeywordArticles] = useState<any[]>([]);
  const [loadingArticles, setLoadingArticles] = useState(false);

  useEffect(() => {
    const loadData = async () => {
      try {
        const response = await axios.get(`${API_BASE}/analytics/top-keywords?limit=50`);
        setKeywords(response.data.keywords || []);
      } catch (error) {
        console.error('Failed to load keywords:', error);
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, []);

  const handleKeywordClick = async (keyword: any) => {
    setSelectedKeyword(keyword);
    setLoadingArticles(true);
    try {
      const response = await axios.post(`${API_BASE}/search/keyword`, {
        keyword: keyword.keyword,
        limit: 20
      });
      setKeywordArticles(response.data.articles || []);
    } catch (error) {
      console.error('Failed to load articles:', error);
    } finally {
      setLoadingArticles(false);
    }
  };

  if (loading) return <div className="card"><div className="skeleton skeleton-block" /></div>;

  const maxFreq = Math.max(...keywords.map(k => k.frequency));

  return (
    <div className="card">
      <div className="section-header">
        <div>
          <div className="section-eyebrow">Frequency</div>
          <h3 className="section-title">
            <BarChartIcon size={16} strokeWidth={1.75} style={{ verticalAlign: '-3px', marginRight: 6 }} />
            Top keywords
          </h3>
        </div>
      </div>
      <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', margin: '0 0 var(--space-3) 0' }}>
        Click any keyword to see articles where it appears.
      </p>

      <div className="kw-cloud">
        {keywords.slice(0, 30).map((kw, idx) => {
          const isSelected = selectedKeyword?.keyword === kw.keyword;
          // Light frequency-driven sizing — clamp to a 2px range so the
          // cloud doesn't look like a teenager's blog header.
          const fontPx = 13 + Math.round((kw.frequency / maxFreq) * 4);
          return (
            <button
              key={idx}
              onClick={() => handleKeywordClick(kw)}
              className={`kw-pill${isSelected ? ' kw-pill--selected' : ''}`}
              style={{ fontSize: `${fontPx}px` }}
            >
              {kw.keyword}
              <span className="kw-pill__count">{kw.frequency}</span>
            </button>
          );
        })}
      </div>

      {selectedKeyword && (
        <>
          <hr className="divider" />
          <h4 className="section-title" style={{ marginBottom: 'var(--space-2)' }}>
            Articles mentioning "{selectedKeyword.keyword}"
            <span style={{ color: 'var(--text-tertiary)', fontWeight: 500 }}> · {keywordArticles.length}</span>
          </h4>

          {loadingArticles ? (
            <div className="stack">
              <div className="skeleton skeleton-line" />
              <div className="skeleton skeleton-line" />
              <div className="skeleton skeleton-line" />
            </div>
          ) : keywordArticles.length > 0 ? (
            <ul className="kw-article-list">
              {keywordArticles.map((article) => (
                <li
                  key={article.id}
                  className="kw-article-row"
                  onClick={() => navigate(`/article/${article.id}`)}
                >
                  <div className="kw-article-row__headline">{article.headline}</div>
                  <div className="kw-article-row__date">
                    {new Date(article.publication_date).toLocaleDateString('en-US', {
                      year: 'numeric', month: 'long', day: 'numeric'
                    })}
                  </div>
                  <div className="kw-article-row__preview">{article.content_preview}…</div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="empty-state">
              <p className="empty-state__body">
                No articles indexed under this keyword. Try a different one.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
};

// Interactive Entity Explorer
export const InteractiveEntityExplorer: React.FC = () => {
  const navigate = useNavigate();
  const [entityType, setEntityType] = useState<string>('all');
  const [entities, setEntities] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedEntity, setSelectedEntity] = useState<any>(null);
  const [entityArticles, setEntityArticles] = useState<any[]>([]);
  const [loadingArticles, setLoadingArticles] = useState(false);

  useEffect(() => {
    loadEntities();
  }, [entityType]);

  const loadEntities = async () => {
    setLoading(true);
    try {
      const params: any = { limit: 30 };
      if (entityType !== 'all') {
        params.entity_type = entityType;
      }
      const response = await axios.get(`${API_BASE}/analytics/top-entities-fixed`, { params });
      setEntities(response.data.entities || []);
    } catch (error) {
      console.error('Failed to load entities:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleEntityClick = async (entity: any) => {
    setSelectedEntity(entity);
    setLoadingArticles(true);
    try {
      const entityName = entity.text || entity.entity || '';
      console.log('Searching for entity:', entityName);
      const response = await axios.post(`${API_BASE}/search/entity`, {
        entity_name: entityName,
        limit: 20
      });
      setEntityArticles(response.data.articles || []);
    } catch (error: any) {
      console.error('Failed to load articles:', error);
      console.error('Error details:', error.response?.data);
      setEntityArticles([]);
    } finally {
      setLoadingArticles(false);
    }
  };

  const entityTypes = ['all', 'PERSON', 'ORG', 'GPE', 'NORP', 'LOC', 'EVENT'];
  const selectedMeta = selectedEntity
    ? (ENTITY_TYPE_INFO[selectedEntity.type] || FALLBACK_ENTITY_META)
    : null;
  const SelectedIcon = selectedMeta?.Icon ?? Pin;

  return (
    <div className="card">
      <div className="section-header">
        <div>
          <div className="section-eyebrow">People · places · organisations</div>
          <h3 className="section-title">
            <Tag size={16} strokeWidth={1.75} style={{ verticalAlign: '-3px', marginRight: 6 }} />
            Named entity explorer
          </h3>
        </div>
      </div>

      {/* Entity Type Selector */}
      <div className="ent-type-row">
        {entityTypes.map((type) => {
          const meta = type === 'all'
            ? ALL_ENTITIES_META
            : (ENTITY_TYPE_INFO[type] || FALLBACK_ENTITY_META);
          const Icon = meta.Icon;
          const isActive = entityType === type;
          return (
            <button
              key={type}
              onClick={() => setEntityType(type)}
              className={`ent-type-pill${isActive ? ' is-active' : ''}`}
              style={isActive ? { background: meta.color, borderColor: meta.color, color: '#fff' } : undefined}
            >
              <Icon size={14} strokeWidth={2} />
              {meta.label}
            </button>
          );
        })}
      </div>

      {entityType !== 'all' && ENTITY_TYPE_INFO[entityType] && (
        <div
          className="ent-type-desc"
          style={{ borderLeftColor: ENTITY_TYPE_INFO[entityType].color }}
        >
          <strong>{ENTITY_TYPE_INFO[entityType].label}:</strong>{' '}
          {ENTITY_TYPE_INFO[entityType].description}
        </div>
      )}

      {loading ? (
        <div className="ent-grid">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="skeleton skeleton-block" style={{ height: '5.5rem' }} />
          ))}
        </div>
      ) : (
        <div className="ent-grid">
          {entities.map((entity, idx) => {
            const meta = ENTITY_TYPE_INFO[entity.type] || FALLBACK_ENTITY_META;
            const Icon = meta.Icon;
            const isSelected = selectedEntity?.text === entity.text;
            return (
              <button
                key={idx}
                onClick={() => handleEntityClick(entity)}
                className={`ent-card${isSelected ? ' is-selected' : ''}`}
                style={{ borderLeftColor: meta.color }}
              >
                <div className="ent-card__head">
                  <Icon size={14} strokeWidth={2} style={{ color: meta.color }} />
                  <span className="chip" style={{ background: meta.color, color: '#fff' }}>
                    {meta.label}
                  </span>
                </div>
                <div className="ent-card__name">{entity.text || entity.entity}</div>
                <div className="ent-card__meta">
                  {entity.count} mention{entity.count === 1 ? '' : 's'}
                  {entity.avg_sentiment !== undefined && entity.avg_sentiment !== null && (
                    <>
                      {' · '}
                      <span style={{
                        color: entity.avg_sentiment > 0.1
                          ? 'var(--positive)'
                          : entity.avg_sentiment < -0.1
                            ? 'var(--negative)'
                            : 'var(--text-tertiary)',
                        fontWeight: 600,
                      }}>
                        {entity.avg_sentiment > 0 ? '+' : ''}{entity.avg_sentiment.toFixed(2)}
                      </span>
                    </>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {selectedEntity && selectedMeta && (
        <>
          <hr className="divider" />
          <div className="ent-detail-head">
            <SelectedIcon size={28} strokeWidth={1.5} style={{ color: selectedMeta.color }} />
            <div>
              <h4 className="section-title" style={{ margin: 0 }}>
                {selectedEntity.text || selectedEntity.entity}
              </h4>
              <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>
                {selectedMeta.label} · {selectedEntity.count} mentions across {entityArticles.length} articles
              </div>
            </div>
          </div>

          {loadingArticles ? (
            <div className="stack">
              <div className="skeleton skeleton-line" />
              <div className="skeleton skeleton-line" />
              <div className="skeleton skeleton-line" />
            </div>
          ) : entityArticles.length > 0 ? (
            <ul className="kw-article-list">
              {entityArticles.map((article) => (
                <li
                  key={article.id}
                  className="kw-article-row"
                  onClick={() => navigate(`/article/${article.id}`)}
                >
                  <div className="kw-article-row__headline">{article.headline}</div>
                  <div className="kw-article-row__date">
                    {new Date(article.publication_date).toLocaleDateString('en-US', {
                      year: 'numeric', month: 'long', day: 'numeric'
                    })}
                  </div>
                  <div className="kw-article-row__preview">{article.content_preview}…</div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="empty-state">
              <p className="empty-state__body">No articles found that mention this entity.</p>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default { InteractiveKeywords, InteractiveEntityExplorer };
