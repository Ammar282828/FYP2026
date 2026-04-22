import React from 'react';
import './ui.css';

interface SkeletonProps {
  width?: string;
  height?: string;
  borderRadius?: string;
  count?: number;
  className?: string;
}

export const Skeleton: React.FC<SkeletonProps> = ({
  width = '100%', height = '1rem', borderRadius = '6px', count = 1, className = ''
}) => (
  <>
    {Array.from({ length: count }).map((_, i) => (
      <div key={i} className={`sk-pulse ${className}`}
        style={{ width, height, borderRadius, marginBottom: count > 1 ? '0.5rem' : 0 }} />
    ))}
  </>
);

export const SkeletonCard: React.FC = () => (
  <div className="sk-card">
    <Skeleton height="1.25rem" width="70%" />
    <Skeleton height="0.85rem" width="40%" />
    <Skeleton height="3rem" />
    <div style={{ display: 'flex', gap: '0.5rem' }}>
      <Skeleton width="5rem" height="1.5rem" borderRadius="12px" />
      <Skeleton width="6rem" height="1.5rem" borderRadius="12px" />
    </div>
  </div>
);

export const SkeletonChart: React.FC = () => (
  <div className="sk-card" style={{ height: '320px' }}>
    <Skeleton height="1.25rem" width="40%" />
    <div style={{ flex: 1, display: 'flex', alignItems: 'flex-end', gap: '6px', paddingTop: '1rem' }}>
      {[40, 65, 50, 80, 35, 70, 55, 90, 45, 60].map((h, i) => (
        <Skeleton key={i} width="100%" height={`${h}%`} borderRadius="4px 4px 0 0" />
      ))}
    </div>
  </div>
);
