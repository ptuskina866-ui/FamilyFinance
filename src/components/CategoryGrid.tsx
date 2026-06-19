import React from 'react';
import * as Icons from 'lucide-react';

// Dynamic Icon Renderer helper
export const DynamicIcon: React.FC<{
  name: string;
  className?: string;
  strokeWidth?: number;
  style?: React.CSSProperties;
}> = ({
  name,
  className = '',
  strokeWidth = 2,
  style
}) => {
  const IconComponent = (Icons as any)[name] || Icons.HelpCircle;
  return <IconComponent className={className} strokeWidth={strokeWidth} style={style} />;
};

interface CategoryGridProps {
  categories: any[];
  selectedId: string;
  onSelect: (id: string) => void;
}

const CategoryGrid: React.FC<CategoryGridProps> = ({ categories, selectedId, onSelect }) => {
  return (
    <div className="grid grid-cols-3 gap-3 p-1">
      {categories.map((category) => {
        const isSelected = selectedId === category.id;

        return (
          <button
            key={category.id}
            onClick={() => onSelect(category.id)}
            type="button"
            className={`flex flex-col items-center justify-center p-3 rounded-2xl border transition-all duration-200 active:scale-95 ${
              isSelected
                ? 'bg-white scale-[1.02] border-green-500'
                : 'bg-white border-slate-200/80 text-slate-500 hover:text-slate-700'
            }`}
            style={{
              boxShadow: isSelected
                ? `0 4px 12px ${category.accentColor}18, 0 1px 3px rgba(0,0,0,0.02)`
                : '0 1px 3px rgba(0,0,0,0.02)',
              borderColor: isSelected ? category.accentColor : undefined
            }}
          >
            {/* Icon Container */}
            <div
              className="w-11 h-11 rounded-2xl flex items-center justify-center mb-2 transition-transform duration-300"
              style={{
                backgroundColor: `${category.accentColor}12`
              }}
            >
              <DynamicIcon
                name={category.icon}
                className="w-5 h-5"
                style={{ color: category.accentColor }}
                strokeWidth={isSelected ? 2.5 : 2}
              />
            </div>
            {/* Label */}
            <span
              className={`text-[12px] font-bold tracking-tight transition-colors ${
                isSelected ? 'text-slate-800' : 'text-slate-500'
              }`}
            >
              {category.name}
            </span>
          </button>
        );
      })}
    </div>
  );
};

export default CategoryGrid;
