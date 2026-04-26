import React, { useRef, useCallback } from 'react';
import { toPng } from 'html-to-image';
import { Download } from 'lucide-react';
import { useToast } from './ui/Toast';

interface ChartExportButtonProps {
  targetRef: React.RefObject<HTMLElement>;
  filenamePrefix?: string;
  label?: string;
  style?: React.CSSProperties;
  className?: string;
}

export const ChartExportButton: React.FC<ChartExportButtonProps> = ({
  targetRef,
  filenamePrefix = 'mediascope-chart',
  label,
  style,
  className,
}) => {
  const { toast } = useToast();
  const busy = useRef(false);

  const onExport = useCallback(async () => {
    if (busy.current) return;
    const node = targetRef.current;
    if (!node) {
      toast('Chart not ready to export', 'error');
      return;
    }
    busy.current = true;
    try {
      // Use a white background for light-theme charts; CSS vars may be transparent.
      const bg = getComputedStyle(document.body).getPropertyValue('--bg-primary').trim() || '#ffffff';
      const dataUrl = await toPng(node, {
        backgroundColor: bg,
        pixelRatio: 2,
        cacheBust: true,
      });
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `${filenamePrefix}-${ts}.png`;
      const link = document.createElement('a');
      link.href = dataUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      toast('Chart exported', 'success');
    } catch (err) {
      console.error('Failed to export chart:', err);
      toast('Failed to export chart', 'error');
    } finally {
      busy.current = false;
    }
  }, [targetRef, filenamePrefix, toast]);

  return (
    <button
      type="button"
      onClick={onExport}
      title="Download chart as PNG"
      className={`btn btn--sm ${className || ''}`.trim()}
      style={style}
    >
      <Download size={14} aria-hidden />
      {label || 'Export'}
    </button>
  );
};

export default ChartExportButton;
