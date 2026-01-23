/**
 * CSV Export Utilities
 */

export const exportToCSV = (data: any[], filename: string) => {
  if (!data || data.length === 0) {
    alert('No data to export');
    return;
  }

  // Get headers from first object
  const headers = Object.keys(data[0]);

  // Convert data to CSV format
  const csvRows = [];

  // Add header row
  csvRows.push(headers.join(','));

  // Add data rows
  for (const row of data) {
    const values = headers.map(header => {
      const value = row[header];

      // Handle different data types
      if (value === null || value === undefined) {
        return '';
      }

      // Escape quotes and wrap in quotes if contains comma or quote
      const stringValue = typeof value === 'object' ? JSON.stringify(value) : String(value);
      const escaped = stringValue.replace(/"/g, '""');

      return escaped.includes(',') || escaped.includes('"') || escaped.includes('\n')
        ? `"${escaped}"`
        : escaped;
    });

    csvRows.push(values.join(','));
  }

  // Create blob and download
  const csvString = csvRows.join('\n');
  const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');

  if (link.download !== undefined) {
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `${filename}_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
};

export const exportComparisonToCSV = (comparisonData: any, entities: string[], filename: string) => {
  const rows = [];

  // Create rows for each entity
  for (const [entity, data] of Object.entries(comparisonData)) {
    const row: any = {
      entity,
      total_mentions: (data as any).total_mentions,
      sentiment_score: (data as any).sentiment.score,
      positive_count: (data as any).sentiment.positive,
      neutral_count: (data as any).sentiment.neutral,
      negative_count: (data as any).sentiment.negative,
    };

    // Add top topics
    const topics = (data as any).top_topics || [];
    topics.slice(0, 3).forEach(([topic, count]: [string, number], idx: number) => {
      row[`topic_${idx + 1}`] = topic;
      row[`topic_${idx + 1}_count`] = count;
    });

    rows.push(row);
  }

  exportToCSV(rows, filename);
};

export const exportLocationDataToCSV = (locations: any[], filename: string) => {
  const rows = locations.map(loc => ({
    location: loc.location,
    total_mentions: loc.total_mentions,
    sentiment_score: loc.sentiment_score,
    positive_count: loc.sentiment.positive,
    neutral_count: loc.sentiment.neutral,
    negative_count: loc.sentiment.negative,
    top_topic_1: loc.top_topics[0] ? loc.top_topics[0][0] : '',
    top_topic_1_count: loc.top_topics[0] ? loc.top_topics[0][1] : 0,
    top_topic_2: loc.top_topics[1] ? loc.top_topics[1][0] : '',
    top_topic_2_count: loc.top_topics[1] ? loc.top_topics[1][1] : 0,
    top_topic_3: loc.top_topics[2] ? loc.top_topics[2][0] : '',
    top_topic_3_count: loc.top_topics[2] ? loc.top_topics[2][1] : 0,
  }));

  exportToCSV(rows, filename);
};
