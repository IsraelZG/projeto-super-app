import React from 'react';

export interface TimelineProps<T> {
  items: T[];
  renderItem: (item: T, index: number) => React.ReactNode;
  layout?: 'vertical' | 'horizontal';
}

export function Timeline<T>({ items, renderItem, layout = 'vertical' }: TimelineProps<T>) {
  return (
    <div className={`flex gap-4 ${layout === 'vertical' ? 'flex-col' : 'flex-row overflow-x-auto'}`}>
      {items.map((item, index) => (
        <div key={index} className="w-full">
          {renderItem(item, index)}
        </div>
      ))}
    </div>
  );
}
