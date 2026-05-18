import React from 'react';

export interface SuperCardProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  body?: React.ReactNode;
  footer?: React.ReactNode;
}

export function SuperCard({ title, subtitle, body, footer }: SuperCardProps) {
  return (
    <div className="bg-card text-card-foreground border border-border rounded-lg shadow-sm overflow-hidden transition-all hover:shadow-md">
      <div className="p-4 sm:p-6 border-b border-border/50">
        <h3 className="text-lg font-semibold tracking-tight">{title}</h3>
        {subtitle && <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>}
      </div>
      
      {body && (
        <div className="p-4 sm:p-6 text-sm">
          {body}
        </div>
      )}

      {footer && (
        <div className="p-4 bg-muted/50 border-t border-border/50 flex items-center">
          {footer}
        </div>
      )}
    </div>
  );
}
