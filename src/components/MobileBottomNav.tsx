import React from 'react';
import {
  FolderKanban,
  LayoutDashboard,
  Menu,
  ShieldAlert,
  UserCheck,
} from 'lucide-react';
import { resolveMobileNavSlot, type MobileNavSlot } from '../utils/mobilePwa';

export interface MobileBottomNavProps {
  activeTab: string;
  onSelectTab: (tab: string) => void;
  onOpenMore: () => void;
  onReselectActiveTab?: () => void;
}

const NAV_ITEMS: Array<{
  slot: MobileNavSlot;
  tabTarget?: string;
  label: string;
  icon: React.ReactNode;
}> = [
  {
    slot: 'overview',
    tabTarget: 'overview',
    label: 'Overview',
    icon: <LayoutDashboard size={19} />,
  },
  {
    slot: 'projects',
    tabTarget: 'projects',
    label: 'Projects',
    icon: <FolderKanban size={19} />,
  },
  {
    slot: 'citizen',
    tabTarget: 'citizen',
    label: 'Citizen',
    icon: <UserCheck size={19} />,
  },
  {
    slot: 'forensics',
    tabTarget: 'evidence',
    label: 'Forensics',
    icon: <ShieldAlert size={19} />,
  },
  {
    slot: 'more',
    label: 'More',
    icon: <Menu size={19} />,
  },
];

export const MobileBottomNav: React.FC<MobileBottomNavProps> = ({
  activeTab,
  onSelectTab,
  onOpenMore,
  onReselectActiveTab,
}) => {
  const activeSlot = resolveMobileNavSlot(activeTab);

  return (
    <nav className="mobile-bottom-nav no-print" aria-label="Mobile Primary Navigation">
      {NAV_ITEMS.map((item) => {
        const isActive = activeSlot === item.slot;
        return (
          <button
            key={item.slot}
            type="button"
            className={`mobile-nav-btn ${isActive ? 'active' : ''}`}
            aria-current={isActive ? 'page' : undefined}
            aria-label={item.slot === 'more' ? 'Open full navigation menu' : item.label}
            onClick={() => {
              if (item.slot === 'more') {
                onOpenMore();
                return;
              }
              if (item.tabTarget) {
                if (activeTab === item.tabTarget) {
                  onReselectActiveTab?.();
                } else {
                  onSelectTab(item.tabTarget);
                }
              }
            }}
          >
            {item.icon}
            <span>{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
};
