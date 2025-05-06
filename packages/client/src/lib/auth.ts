import { jwtDecode } from 'jwt-decode';

export interface JwtPayload {
	iss?: string;
	sub?: string; //Subject ID
	aud?: string[] | string;
	exp?: number;
	nbf?: number;
	iat?: number;
	jti?: string;
}

export const handleAuthCallback = async (url: string) => {
  try {
    const hash = url.split('#')[1];
    const params = new URLSearchParams(hash);
    const idToken = params.get('id_token');

    if (!idToken) {
      throw new Error('ID token not found');
    }

    const decodedJwt = jwtDecode(idToken) as JwtPayload;
    
    return {
      decodedJwt,
    };
  } catch (error) {
    console.error('Auth callback error:', error);
    throw error;
  }
};