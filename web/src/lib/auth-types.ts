export interface Organization {
  id: string;
  name: string;
  role: 'owner' | 'admin' | 'member';
  created_at: string;
}

export interface AuthUser {
  id: string;
  email?: string;
}

export interface MeResponse {
  user: AuthUser;
  organizations: Organization[];
}

export interface LoginResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user: AuthUser;
  organizations: Organization[];
}

export interface SignupResponse extends LoginResponse {
  organization?: Organization;
  message?: string;
}
