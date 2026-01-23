-- MediaScope Database Schema
-- PostgreSQL database for Dawn newspaper archive (1990-1992)

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- CORE TABLES
-- ============================================

-- Users table
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username VARCHAR(100) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_login TIMESTAMP,
    is_active BOOLEAN DEFAULT TRUE
);

-- Newspapers table (represents individual newspaper issues)
CREATE TABLE newspapers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    publication_date DATE NOT NULL,
    year INTEGER NOT NULL,
    month INTEGER NOT NULL,
    day INTEGER NOT NULL,
    page_number INTEGER NOT NULL,
    section VARCHAR(100),
    image_path TEXT NOT NULL,
    processed_image_path TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    processed_at TIMESTAMP,
    UNIQUE(publication_date, page_number)
);

-- Articles table
CREATE TABLE articles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    newspaper_id UUID REFERENCES newspapers(id) ON DELETE CASCADE,
    article_number INTEGER NOT NULL,
    headline TEXT NOT NULL,
    content TEXT NOT NULL,
    word_count INTEGER,
    bounding_box JSONB, -- {x, y, width, height}
    sentiment_score FLOAT, -- -1 to 1 (negative to positive)
    sentiment_label VARCHAR(20), -- 'positive', 'neutral', 'negative'
    topic_label VARCHAR(100),
    topic_id INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Named entities table
CREATE TABLE entities (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    article_id UUID REFERENCES articles(id) ON DELETE CASCADE,
    entity_text VARCHAR(255) NOT NULL,
    entity_type VARCHAR(50) NOT NULL, -- PERSON, ORG, GPE, LOC, etc.
    start_char INTEGER,
    end_char INTEGER,
    confidence FLOAT
);

-- Entity index for fast lookups
CREATE INDEX idx_entities_text ON entities(entity_text);
CREATE INDEX idx_entities_type ON entities(entity_type);
CREATE INDEX idx_entities_article ON entities(article_id);

-- Topics table (for BERTopic results)
CREATE TABLE topics (
    id SERIAL PRIMARY KEY,
    topic_id INTEGER UNIQUE NOT NULL,
    topic_name VARCHAR(255) NOT NULL,
    keywords TEXT[], -- Array of representative keywords
    description TEXT,
    article_count INTEGER DEFAULT 0
);

-- Advertisements table
CREATE TABLE advertisements (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    newspaper_id UUID REFERENCES newspapers(id) ON DELETE CASCADE,
    bounding_box JSONB NOT NULL, -- {x, y, width, height}
    image_path TEXT,
    extracted_text TEXT,
    industry_category VARCHAR(100),
    product_category VARCHAR(100),
    brand_name VARCHAR(255),
    gender_representation VARCHAR(50), -- 'male', 'female', 'both', 'none'
    cultural_style VARCHAR(50), -- 'traditional', 'modern', 'western', 'mixed'
    visual_elements JSONB, -- Array of detected visual elements
    confidence_score FLOAT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- User collections (bookmarks)
CREATE TABLE collections (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    is_public BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Collection items (many-to-many between collections and articles)
CREATE TABLE collection_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    collection_id UUID REFERENCES collections(id) ON DELETE CASCADE,
    article_id UUID REFERENCES articles(id) ON DELETE CASCADE,
    notes TEXT,
    added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(collection_id, article_id)
);

-- Search history
CREATE TABLE search_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    search_type VARCHAR(50) NOT NULL, -- 'keyword', 'entity', 'topic'
    search_query TEXT NOT NULL,
    filters JSONB,
    result_count INTEGER,
    searched_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- INDEXES FOR PERFORMANCE
-- ============================================

-- Newspapers indexes
CREATE INDEX idx_newspapers_date ON newspapers(publication_date);
CREATE INDEX idx_newspapers_year ON newspapers(year);
CREATE INDEX idx_newspapers_month ON newspapers(month);
CREATE INDEX idx_newspapers_page ON newspapers(page_number);

-- Articles indexes
CREATE INDEX idx_articles_newspaper ON articles(newspaper_id);
CREATE INDEX idx_articles_sentiment ON articles(sentiment_score);
CREATE INDEX idx_articles_topic ON articles(topic_id);
CREATE INDEX idx_articles_headline ON articles USING gin(to_tsvector('english', headline));
CREATE INDEX idx_articles_content ON articles USING gin(to_tsvector('english', content));

-- Advertisements indexes
CREATE INDEX idx_ads_newspaper ON advertisements(newspaper_id);
CREATE INDEX idx_ads_industry ON advertisements(industry_category);
CREATE INDEX idx_ads_product ON advertisements(product_category);
CREATE INDEX idx_ads_brand ON advertisements(brand_name);

-- ============================================
-- VIEWS FOR COMMON QUERIES
-- ============================================

-- Article with metadata view
CREATE VIEW article_details AS
SELECT 
    a.id,
    a.headline,
    a.content,
    a.word_count,
    a.sentiment_score,
    a.sentiment_label,
    a.topic_label,
    a.topic_id,
    n.publication_date,
    n.year,
    n.month,
    n.day,
    n.page_number,
    n.section,
    n.image_path,
    t.topic_name,
    t.keywords as topic_keywords
FROM articles a
JOIN newspapers n ON a.newspaper_id = n.id
LEFT JOIN topics t ON a.topic_id = t.topic_id;

-- Entity mentions aggregated
CREATE VIEW entity_mentions AS
SELECT 
    e.entity_text,
    e.entity_type,
    COUNT(*) as mention_count,
    COUNT(DISTINCT a.newspaper_id) as newspaper_count,
    MIN(n.publication_date) as first_mention,
    MAX(n.publication_date) as last_mention,
    AVG(a.sentiment_score) as avg_sentiment
FROM entities e
JOIN articles a ON e.article_id = a.id
JOIN newspapers n ON a.newspaper_id = n.id
GROUP BY e.entity_text, e.entity_type;

-- Topic distribution over time
CREATE VIEW topic_timeline AS
SELECT 
    t.topic_id,
    t.topic_name,
    n.year,
    n.month,
    COUNT(a.id) as article_count,
    AVG(a.sentiment_score) as avg_sentiment
FROM articles a
JOIN newspapers n ON a.newspaper_id = n.id
JOIN topics t ON a.topic_id = t.topic_id
GROUP BY t.topic_id, t.topic_name, n.year, n.month
ORDER BY n.year, n.month, article_count DESC;

-- Advertisement trends
CREATE VIEW ad_trends AS
SELECT 
    ad.industry_category,
    ad.product_category,
    n.year,
    n.month,
    COUNT(*) as ad_count,
    COUNT(DISTINCT ad.brand_name) as unique_brands
FROM advertisements ad
JOIN newspapers n ON ad.newspaper_id = n.id
GROUP BY ad.industry_category, ad.product_category, n.year, n.month;

-- ============================================
-- FUNCTIONS FOR ANALYTICS
-- ============================================

-- Function to get keyword frequency over time
CREATE OR REPLACE FUNCTION get_keyword_frequency(
    keyword TEXT,
    start_date DATE DEFAULT NULL,
    end_date DATE DEFAULT NULL
)
RETURNS TABLE(
    publication_date DATE,
    mention_count BIGINT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        n.publication_date,
        COUNT(DISTINCT a.id) as mention_count
    FROM articles a
    JOIN newspapers n ON a.newspaper_id = n.id
    WHERE 
        (to_tsvector('english', a.content) @@ plainto_tsquery('english', keyword)
         OR to_tsvector('english', a.headline) @@ plainto_tsquery('english', keyword))
        AND (start_date IS NULL OR n.publication_date >= start_date)
        AND (end_date IS NULL OR n.publication_date <= end_date)
    GROUP BY n.publication_date
    ORDER BY n.publication_date;
END;
$$ LANGUAGE plpgsql;

-- Function to get entity mention trends
CREATE OR REPLACE FUNCTION get_entity_trends(
    entity_name TEXT,
    entity_type_filter VARCHAR(50) DEFAULT NULL,
    start_date DATE DEFAULT NULL,
    end_date DATE DEFAULT NULL
)
RETURNS TABLE(
    publication_date DATE,
    mention_count BIGINT,
    avg_sentiment FLOAT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        n.publication_date,
        COUNT(e.id) as mention_count,
        AVG(a.sentiment_score) as avg_sentiment
    FROM entities e
    JOIN articles a ON e.article_id = a.id
    JOIN newspapers n ON a.newspaper_id = n.id
    WHERE 
        e.entity_text ILIKE '%' || entity_name || '%'
        AND (entity_type_filter IS NULL OR e.entity_type = entity_type_filter)
        AND (start_date IS NULL OR n.publication_date >= start_date)
        AND (end_date IS NULL OR n.publication_date <= end_date)
    GROUP BY n.publication_date
    ORDER BY n.publication_date;
END;
$$ LANGUAGE plpgsql;

-- Function to get topic distribution for a time period
CREATE OR REPLACE FUNCTION get_topic_distribution(
    start_date DATE,
    end_date DATE
)
RETURNS TABLE(
    topic_id INTEGER,
    topic_name VARCHAR(255),
    article_count BIGINT,
    percentage FLOAT
) AS $$
BEGIN
    RETURN QUERY
    WITH topic_counts AS (
        SELECT 
            t.topic_id,
            t.topic_name,
            COUNT(a.id) as count
        FROM topics t
        LEFT JOIN articles a ON t.topic_id = a.topic_id
        JOIN newspapers n ON a.newspaper_id = n.id
        WHERE n.publication_date BETWEEN start_date AND end_date
        GROUP BY t.topic_id, t.topic_name
    ),
    total_count AS (
        SELECT SUM(count) as total FROM topic_counts
    )
    SELECT 
        tc.topic_id,
        tc.topic_name,
        tc.count as article_count,
        (tc.count::FLOAT / NULLIF(t.total, 0) * 100) as percentage
    FROM topic_counts tc
    CROSS JOIN total_count t
    ORDER BY tc.count DESC;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- TRIGGERS
-- ============================================

-- Update article count in topics table
CREATE OR REPLACE FUNCTION update_topic_article_count()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        UPDATE topics 
        SET article_count = article_count + 1 
        WHERE topic_id = NEW.topic_id;
    ELSIF TG_OP = 'DELETE' THEN
        UPDATE topics 
        SET article_count = article_count - 1 
        WHERE topic_id = OLD.topic_id;
    ELSIF TG_OP = 'UPDATE' AND OLD.topic_id != NEW.topic_id THEN
        UPDATE topics 
        SET article_count = article_count - 1 
        WHERE topic_id = OLD.topic_id;
        UPDATE topics 
        SET article_count = article_count + 1 
        WHERE topic_id = NEW.topic_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_topic_count
AFTER INSERT OR UPDATE OR DELETE ON articles
FOR EACH ROW
EXECUTE FUNCTION update_topic_article_count();

-- Update timestamp on article updates
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_article_timestamp
BEFORE UPDATE ON articles
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- SAMPLE QUERIES FOR TESTING
-- ============================================

-- Search articles by keyword
-- SELECT * FROM articles WHERE to_tsvector('english', content) @@ plainto_tsquery('english', 'politics');

-- Get top mentioned entities
-- SELECT entity_text, mention_count FROM entity_mentions ORDER BY mention_count DESC LIMIT 10;

-- Get keyword frequency trend
-- SELECT * FROM get_keyword_frequency('election', '1990-01-01', '1992-12-31');

-- Get entity trends
-- SELECT * FROM get_entity_trends('Benazir', 'PERSON', '1990-01-01', '1992-12-31');

-- Get topic distribution
-- SELECT * FROM get_topic_distribution('1990-01-01', '1990-12-31');

-- Get articles with sentiment filter
-- SELECT * FROM article_details WHERE sentiment_label = 'positive' ORDER BY publication_date;

-- Advertisement trends by industry
-- SELECT * FROM ad_trends WHERE industry_category = 'Automotive' ORDER BY year, month;
