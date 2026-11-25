export type UserRole = 'user' | 'moderator' | 'admin';

export interface User {
  id: string;
  name: string;
  email: string;
  phone: string;
  location: string;
  avatar_url: string;
  role: UserRole;
  is_blocked: boolean;
  is_verified_account: boolean;
  is_sample?: boolean;
  ads_count?: number;
  created_at: string;
}

export interface Subcategory {
  id: string;
  category_id: string;
  slug: string;
  name_ar: string;
  sort_order: number;
  is_active: boolean;
}

export interface Category {
  id: string;
  slug: string;
  name_ar: string;
  icon: string;
  sort_order: number;
  is_active: boolean;
  ads_count?: number;
  subcategories: Subcategory[];
}

export type AdType = 'offer' | 'wanted' | 'job' | 'announcement';
export type AdStatus = 'pending' | 'approved' | 'rejected' | 'sold';

export interface Ad {
  id: string;
  user_id: string;
  category_id: string;
  subcategory_id: string | null;
  category_name: string;
  category_slug: string;
  subcategory_name: string | null;
  subcategory_slug: string | null;
  title: string;
  description: string;
  price: number;
  is_negotiable: boolean;
  ad_type: AdType;
  location: string;
  contact_phone: string;
  contact_whatsapp: string;
  document_info: string;
  has_verified_docs: boolean;
  status: AdStatus;
  rejection_reason: string;
  is_featured: boolean;
  is_sample: boolean;
  views_count: number;
  created_at: string;
  updated_at: string;
  owner_name: string;
  owner_email?: string;
  owner_avatar: string;
  owner_verified: boolean;
  owner_location?: string;
  owner_joined_at?: string;
  images: string[];
  is_favorited: boolean;
}

export interface Conversation {
  other_user_id: string;
  other_user_name: string;
  other_user_avatar: string;
  other_user_verified: boolean;
  ad_id: string | null;
  ad_title: string;
  last_message: string;
  last_at: string;
  unread_count: number;
}

export interface ChatMessage {
  id: string;
  ad_id: string | null;
  sender_id: string;
  receiver_id: string;
  sender_name: string;
  body: string;
  is_read: boolean;
  created_at: string;
}

export interface ReportItem {
  id: string;
  reporter_id: string;
  reporter_name: string;
  reporter_email?: string;
  target_type: 'ad' | 'user';
  target_ad_id: string | null;
  target_ad_title: string | null;
  target_ad_status?: string | null;
  target_user_id: string | null;
  target_user_name: string | null;
  target_user_blocked?: boolean;
  reason: string;
  details: string;
  status: 'open' | 'reviewed' | 'dismissed';
  admin_note: string;
  created_at: string;
}

export interface AdminOverview {
  stats: {
    totalUsers: number;
    blockedUsers: number;
    pendingAds: number;
    approvedAds: number;
    rejectedAds: number;
    openReports: number;
    totalMessages: number;
  };
  logs: Array<{
    id: string;
    actor_id: string | null;
    actor_name: string | null;
    action: string;
    target_info: string;
    created_at: string;
  }>;
}

export interface HeroPromotion {
  id: string;
  ad_id: string | null;
  user_id: string;
  title: string;
  subtitle: string;
  image_url: string;
  price_label: string;
  location_label: string;
  package_days: number;
  amount_sdg: number;
  payment_method: string;
  payment_reference: string;
  payment_receipt_url?: string;
  status: 'pending' | 'active' | 'paused' | 'rejected' | 'expired';
  sort_order: number;
  is_sample: boolean;
  starts_at: string;
  expires_at: string;
  admin_note: string;
  created_at: string;
  owner_name?: string;
  owner_email?: string;
  owner_phone?: string;
  owner_verified?: boolean;
  ad_title?: string;
  category_name?: string;
}

export type NotificationType =
  | 'message'
  | 'ad_approved'
  | 'ad_rejected'
  | 'hero_active'
  | 'hero_rejected'
  | 'system';

export interface AppNotification {
  id: string;
  user_id: string;
  title: string;
  body: string;
  type: NotificationType;
  link_ad_id: string;
  link_user_id: string;
  link_page: string;
  is_read: boolean;
  created_at: string;
}

export type AppRoute =
  | { page: 'home' }
  | {
      page: 'search';
      category?: string;
      subcategory?: string;
      q?: string;
      adType?: string;
      userId?: string;
      sellerName?: string;
    }
  | { page: 'ad-detail'; adId: string }
  | { page: 'ad-new' }
  | { page: 'ad-edit'; adId: string }
  | { page: 'favorites' }
  | { page: 'messages'; withUserId?: string; adId?: string | null }
  | { page: 'account'; tab?: 'profile' | 'my-ads' }
  | { page: 'auth'; mode?: 'login' | 'register' | 'forgot' }
  | {
      page: 'admin';
      tab?: 'overview' | 'ads' | 'hero-ads' | 'users' | 'reports' | 'categories';
    };
