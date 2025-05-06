import { apiClient } from './api';

export const handleAuthCallback = async (url: string) => {
  try {
    const hash = url.split('#')[1];
    const params = new URLSearchParams(hash);
    const idToken = params.get('id_token');

    if (!idToken) {
      throw new Error('ID token not found');
    }

    const jwtResponse = await apiClient.verifyJwt(idToken);
    
    const userSaltResponse = await apiClient.getUserSalt();
    
    const zkProofResponse = await apiClient.getZkProof(idToken, userSaltResponse.data);
    
    return {
      jwtResponse,
      userSaltResponse,
      zkProofResponse,
    };
  } catch (error) {
    console.error('Auth callback error:', error);
    throw error;
  }
};
