import React from 'react';
import { CardColor } from '../types';

interface ColorChooserProps {
  onSelect: (color: CardColor) => void;
  onCancel?: () => void;
}

export const ColorChooser: React.FC<ColorChooserProps> = ({ onSelect, onCancel }) => {
  const choices: { color: CardColor; label: string; bg: string; hover: string; text: string }[] = [
    { color: 'red', label: 'RED', bg: 'bg-rose-500', hover: 'hover:bg-rose-600', text: 'text-white' },
    { color: 'blue', label: 'BLUE', bg: 'bg-sky-500', hover: 'hover:bg-sky-600', text: 'text-white' },
    { color: 'green', label: 'GREEN', bg: 'bg-emerald-500', hover: 'hover:bg-emerald-600', text: 'text-white' },
    { color: 'yellow', label: 'YELLOW', bg: 'bg-amber-400', hover: 'hover:bg-amber-500', text: 'text-zinc-900 font-bold' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="bg-zinc-900 border-2 border-zinc-700 rounded-2xl p-6 w-full max-w-sm text-center shadow-2xl animate-scale-up">
        <h3 className="text-xl font-bold text-white mb-1">🌈 Choose Wild Color</h3>
        <p className="text-xs text-zinc-400 mb-6">Select which color should become active next:</p>

        <div className="grid grid-cols-2 gap-4">
          {choices.map((choice) => (
            <button
              key={choice.color}
              id={`choose-color-${choice.color}`}
              onClick={() => onSelect(choice.color)}
              className={`
                h-24 rounded-xl flex flex-col items-center justify-center cursor-pointer transition-all duration-200
                active:scale-95 shadow-md active:shadow-inner font-extrabold text-sm tracking-widest
                ${choice.bg} ${choice.hover} ${choice.text}
                hover:scale-105 hover:shadow-lg
              `}
            >
              <div className="w-6 h-6 border-2 border-current rounded-full mb-1 flex items-center justify-center">
                <div className="w-2 h-2 bg-current rounded-full" />
              </div>
              {choice.label}
            </button>
          ))}
        </div>

        {onCancel && (
          <button
            id="cancel-color-choice"
            onClick={onCancel}
            className="mt-6 text-sm text-zinc-400 hover:text-white transition"
          >
            Cancel Selection
          </button>
        )}
      </div>
    </div>
  );
};
