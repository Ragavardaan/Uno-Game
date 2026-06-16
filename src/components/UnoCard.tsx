import React from 'react';
import { Card, CardColor } from '../types';

interface UnoCardProps {
  card: Card;
  isPlayable?: boolean;
  onClick?: () => void;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  hoverEffect?: boolean;
  disabled?: boolean;
}

export const UnoCard: React.FC<UnoCardProps> = ({
  card,
  isPlayable = true,
  onClick,
  size = 'md',
  hoverEffect = true,
  disabled = false,
}) => {
  const { color, value } = card;

  // Determine size classes
  const sizeClasses = {
    sm: 'w-16 h-24 text-xs rounded-md shadow',
    md: 'w-24 h-36 border-2 rounded-lg shadow-md',
    lg: 'w-28 h-40 border-4 rounded-xl shadow-lg',
    xl: 'w-36 h-52 border-4 rounded-2xl shadow-xl',
  };

  const textSizes = {
    sm: 'text-sm font-black',
    md: 'text-2xl font-black',
    lg: 'text-3xl font-black',
    xl: 'text-5xl font-black',
  };

  const cornerSizes = {
    sm: 'text-[9px] p-0.5',
    md: 'text-xs p-1',
    lg: 'text-sm p-1.5',
    xl: 'text-lg p-2.5',
  };

  // Determine color theme for card backgrounds
  const colorMap: Record<CardColor, string> = {
    red: 'from-rose-500 to-red-600 border-white',
    blue: 'from-sky-500 to-blue-600 border-white',
    green: 'from-emerald-500 to-green-600 border-white',
    yellow: 'from-amber-300 to-yellow-500 border-white text-zinc-900',
    black: 'from-zinc-800 to-zinc-950 border-white',
  };

  // Human friendly card display text
  const getSymbol = () => {
    switch (value) {
      case 'Skip':
        return '🚫';
      case 'Reverse':
        return '⇅';
      case 'Draw2':
        return '+2';
      case 'Wild':
        return 'W';
      case 'Wild4':
        return '+4';
      default:
        return value;
    }
  };

  const renderWildCenter = () => {
    return (
      <div className="absolute inset-0 flex flex-wrap rounded-full overflow-hidden w-4/5 h-4/5 m-auto">
        <div className="w-1/2 h-1/2 bg-rose-500" />
        <div className="w-1/2 h-1/2 bg-sky-500" />
        <div className="w-1/2 h-1/2 bg-yellow-400" />
        <div className="w-1/2 h-1/2 bg-emerald-500" />
      </div>
    );
  };

  // Click handler with guard
  const handleCardClick = () => {
    if (!disabled && onClick) {
      onClick();
    }
  };

  return (
    <div
      id={`card-${card.uid}`}
      onClick={handleCardClick}
      className={`
        relative select-none flex flex-col justify-between overflow-hidden bg-gradient-to-br cursor-pointer
        ${colorMap[color]}
        ${sizeClasses[size]}
        ${hoverEffect && isPlayable && !disabled ? 'hover:-translate-y-6 hover:scale-110 active:scale-95 hover:shadow-2xl hover:z-20' : ''}
        ${!isPlayable && !disabled ? 'opacity-40 cursor-not-allowed contrast-75' : ''}
        ${disabled ? 'opacity-90 cursor-default' : ''}
        transition-all duration-300 ease-out
      `}
    >
      {/* Corner Value Top-Left */}
      <div className={`absolute top-0 left-0 text-left font-black leading-none ${cornerSizes[size]} text-inherit flex flex-col items-center`}>
        <span>{getSymbol()}</span>
        <div className={`w-2 h-[2px] mt-0.5 rounded-full ${color === 'yellow' ? 'bg-zinc-800' : 'bg-white'}`} />
      </div>

      {/* Slanted main white card center indicator */}
      <div className="relative w-[86%] h-[72%] my-auto mx-auto rounded-[40%] bg-white/10 flex items-center justify-center transform rotate-[-22deg] overflow-hidden">
        {/* Inside slanted area */}
        <div className="absolute inset-0 flex items-center justify-center transform rotate-[22deg]">
          {color === 'black' ? (
            <div className="relative w-full h-full flex items-center justify-center">
              {renderWildCenter()}
              <span className={`absolute z-10 drop-shadow-md text-white font-black drop-shadow-[0_2px_4px_rgba(0,0,0,0.6)] ${textSizes[size]}`}>
                {value === 'Wild4' ? '+4' : 'W'}
              </span>
            </div>
          ) : (
            <span
              className={`
                font-black tracking-tighter drop-shadow-[0_2px_2px_rgba(0,0,0,0.2)]
                ${textSizes[size]}
                ${color === 'yellow' ? 'text-zinc-800' : 'text-white'}
              `}
            >
              {getSymbol()}
            </span>
          )}
        </div>
      </div>

      {/* Corner Value Bottom-Right */}
      <div className={`absolute bottom-0 right-0 text-right font-black leading-none ${cornerSizes[size]} text-inherit flex flex-col items-center transform rotate-180`}>
        <span>{getSymbol()}</span>
        <div className={`w-2 h-[2px] mt-0.5 rounded-full ${color === 'yellow' ? 'bg-zinc-800' : 'bg-white'}`} />
      </div>

      {/* Dynamic playability highlight */}
      {isPlayable && !disabled && (
        <div className="absolute inset-0 ring-2 ring-white/40 opacity-0 hover:opacity-100 transition-opacity duration-200 pointer-events-none rounded-inherit" />
      )}
    </div>
  );
};
