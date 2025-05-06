import { jwtDecode } from 'jwt-decode';
import { jwtToAddress, getExtendedEphemeralPublicKey, getZkLoginSignature, genAddressSeed } from '@mysten/sui/zklogin';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import axios from 'axios';

// export type PartialZkLoginSignature = Omit<
// 	Parameters<typeof getZkLoginSignature>['0']['inputs'],
// 	'addressSeed'
// >;

export interface JwtPayload {
	iss?: string;
	sub?: string; //Subject ID
	aud?: string[] | string;
	exp?: number;
	nbf?: number;
	iat?: number;
	jti?: string;
}

export type ZkLogin = {
  keyPair: Ed25519Keypair;
  decodedJwt: JwtPayload;
  zkProof: any;
  zkLoginAddress: string;
}

export const handleAuthCallback = (url: string) => {
  try {
    const hash = url.split('#')[1];
    const params = new URLSearchParams(hash);
    const idToken = params.get('id_token');

    if (!idToken) {
      return false;
      // throw new Error('ID token not found');
    }

    return idToken;
  } catch (error) {
    console.error('Auth callback error:', error);
    throw error;
  }
};

export const getZkProof = async (jwt: string, ephemeralKeyPair: Ed25519Keypair, maxEpoch: string, randomness: string, userSalt: string) => {
  // 확장된 임시 공개키 생성
  const extendedEphemeralPublicKey = getExtendedEphemeralPublicKey(
    ephemeralKeyPair.getPublicKey()
  );

  // 2. ZK Proving Service에 요청할 페이로드 구성
  const payload = {
    jwt: jwt,
    extendedEphemeralPublicKey: extendedEphemeralPublicKey,
    maxEpoch: maxEpoch,
    jwtRandomness: randomness,
    salt: userSalt,
    keyClaimName: "sub" // 기본적으로 "sub" 사용, OAuth 제공자에 따라 다를 수 있음
  };
  
  // 3. Mysten Labs의 Proving Service 호출 
  // (devnet은 무료로 사용 가능, mainnet은 권한 필요)
  const PROVER_URL = "https://prover-dev.mystenlabs.com/v1"; // devnet용
  // const PROVER_URL = "https://prover.mystenlabs.com/v1"; // mainnet용 (권한 필요)
  
  try {
    const response = await axios.post(PROVER_URL, payload, {
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    if (response.status !== 200) {
      throw new Error(`Proving service error: ${response.status}`);
    }
    
    // 4. ZK 증명 응답 받기
    const zkProof = response.data;
    return zkProof;
  } catch (error) {
    console.error('Failed to get ZK proof:', error);
    throw error;
  }
};