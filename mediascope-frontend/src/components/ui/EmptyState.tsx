import React from 'react';
import './ui.css';

interface EmptyStateProps {
  // Accepts a Lucide icon component, an SVG, or any other ReactNode.
  // Strings still work for back-compat with callers that pass an emoji,
  // but new code should pass an icon component (e.g. `<Search size={28} />`).
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
}

const EmptyState: React.FC<EmptyStateProps> = ({ icon, title, description, action }) => (
  <div className="empty-state">
    {icon && <div className="empty-state-icon">{icon}</div>}
    <h3 className="empty-state-title">{title}</h3>
    {description && <p className="empty-state-desc">{description}</p>}
    {action && (
      <button className="empty-state-btn" onClick={action.onClick}>{action.label}</button>
    )}
  </div>
);

export default EmptyState;
