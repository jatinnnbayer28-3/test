/**
 * Mobile bottom navigation bar — shown only on screens < 768px (md breakpoint).
 *
 * Provides thumb-friendly navigation for phone users with an iOS/Android-style
 * fixed bottom tab bar. Hides automatically on desktop where the top Navbar
 * is sufficient.
 *
 * Includes safe-area padding for notched phones (iPhone X+, etc.).
 */

import { NavLink } from 'react-router-dom';
import { Shirt, CalendarDays, Sparkles, Clock, User } from 'lucide-react';

const tabs = [
  { to: '/wardrobe', icon: Shirt, label: 'Wardrobe' },
  { to: '/calendar', icon: CalendarDays, label: 'Calendar' },
  { to: '/outfits', icon: Sparkles, label: 'Outfits' },
  { to: '/history', icon: Clock, label: 'History' },
  { to: '/avatar', icon: User, label: 'Avatar' },
];

export default function MobileNav() {
  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-white/95 backdrop-blur-md border-t border-gray-200 pb-safe">
      <div className="flex items-center justify-around h-16 px-2">
        {tabs.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex flex-col items-center justify-center gap-0.5 px-2 py-1 rounded-lg transition-colors min-w-0 ${
                isActive
                  ? 'text-indigo-600'
                  : 'text-gray-400 active:text-gray-600'
              }`
            }
          >
            <Icon className="w-5 h-5 flex-shrink-0" />
            <span className="text-[10px] font-medium truncate">{label}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
