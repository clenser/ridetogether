import {
  Bell,
  Car,
  CircleUserRound,
  Home,
  PlusCircle,
  Route,
  Search,
  Settings,
  ShieldCheck,
  TicketCheck,
  type LucideIcon,
} from "lucide-react";

export interface NavigationItem {
  label: string;
  to: string;
  icon: LucideIcon;
  /** Match the path exactly, so "/" does not stay active on every route. */
  end?: boolean;
  /** Give the item extra visual weight, used for the primary call to action. */
  emphasis?: boolean;
  /**
   * Keep the destination out of the compact quick-jump list that global search
   * shows on small screens, where the bottom navigation already covers it.
   */
  hiddenOnMobile?: boolean;
}

/**
 * The single source of truth for where the app can take you.
 *
 * The sidebar, the mobile tab bar and the global quick search all used to carry
 * their own copy of this list, which meant a new page or a renamed label had to
 * be added in three places and quietly drifted apart when it was not.
 */
export const navigationItems: NavigationItem[] = [
  { label: "Home", to: "/", icon: Home, end: true },
  { label: "Find a ride", to: "/find", icon: Search },
  { label: "Offer a ride", to: "/offer", icon: PlusCircle, emphasis: true },
  { label: "My rides", to: "/rides", icon: Route },
  { label: "My bookings", to: "/bookings", icon: TicketCheck, hiddenOnMobile: true },
  { label: "Notifications", to: "/notifications", icon: Bell, hiddenOnMobile: true },
  { label: "Profile", to: "/profile", icon: CircleUserRound, hiddenOnMobile: true },
  { label: "Vehicles", to: "/vehicles", icon: Car, hiddenOnMobile: true },
  { label: "Safety", to: "/safety", icon: ShieldCheck, hiddenOnMobile: true },
  { label: "Settings", to: "/settings", icon: Settings, hiddenOnMobile: true },
];
