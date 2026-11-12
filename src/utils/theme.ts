import { useEffect, useState } from 'react';

export function useIsLightTheme(): boolean {
  const [isLight, setIsLight] = useState(() =>
    typeof document !== 'undefined'
      ? document.documentElement.classList.contains('theme-light')
      : false
  );

  useEffect(() => {
    const root = document.documentElement;
    const sync = () => setIsLight(root.classList.contains('theme-light'));
    sync();

    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  return isLight;
}

export function getChartTheme(isLight: boolean) {
  if (isLight) {
    return {
      tooltipBg: 'rgba(255, 255, 255, 0.96)',
      tooltipBorder: 'rgba(15, 23, 42, 0.14)',
      tooltipText: '#0f172a',
      tooltipSubText: '#64748b',
      axisLine: 'rgba(15, 23, 42, 0.14)',
      splitLine: 'rgba(15, 23, 42, 0.08)',
      splitLineSubtle: 'rgba(15, 23, 42, 0.06)',
      axisLabel: '#64748b',
      mobileAxisLabel: 'rgba(71, 85, 105, 0.85)',
    };
  }
  return {
    tooltipBg: 'rgba(18, 18, 18, 0.96)',
    tooltipBorder: 'rgba(255, 255, 255, 0.14)',
    tooltipText: '#f5f5f5',
    tooltipSubText: '#94a3b8',
    axisLine: 'rgba(255, 255, 255, 0.09)',
    splitLine: 'rgba(255, 255, 255, 0.06)',
    splitLineSubtle: 'rgba(255, 255, 255, 0.04)',
    axisLabel: '#7A7E85',
    mobileAxisLabel: 'rgba(160, 165, 170, 0.72)',
  };
}
