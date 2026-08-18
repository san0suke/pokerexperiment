/** Public user shape — never includes the password hash. */
export interface PublicUser {
  id: string;
  username: string;
  email: string;
  chips: number;
}

export interface AuthResponse {
  token: string;
  user: PublicUser;
}
