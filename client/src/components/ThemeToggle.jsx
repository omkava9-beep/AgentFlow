import { Moon, Sun } from 'lucide-react';
import { useThemeStore } from '../store/themeStore';
import { IconButton } from './ui/Button';

export default function ThemeToggle() {
  const { theme, toggle } = useThemeStore();
  return <IconButton icon={theme === 'dark' ? Sun : Moon} label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'} onClick={toggle} />;
}
