import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { 
  generateNonce, 
  generateRandomness, 
  genAddressSeed, 
  getZkLoginSignature, 
  jwtToAddress
} from '@mysten/sui/zklogin';
import {jwtDecode } from 'jwt-decode';

// JWT 페이로드 타입 정의
interface JwtPayload {
  iss?: string;
  sub?: string; // Subject ID
  aud?: string[] | string;
  exp?: number;
  nbf?: number;
  iat?: number;
  jti?: string;
}

// 지갑 옵션 타입 정의
export interface WalletOption {
  id: string;
  name: string;
  icon: string;
  description: string;
  isAvailable: boolean;
}

// ZkLogin 상태 인터페이스
interface ZkLoginState {
  ephemeralKeyPair: Ed25519Keypair | null;
  maxEpoch: number | null;
  randomness: string | null;
  nonce: string | null;
  jwt: string | null;
  zkProof: any | null; // 실제 zkProof 타입에 맞게 수정 필요
  userSalt: string | null;
}

// 컨텍스트 타입 정의
interface WalletContextType {
  isWalletConnected: boolean;
  walletAddress: string | null;
  isConnecting: boolean;
  suiClient: SuiClient | null;
  balance: string | null;
  connectWallet: (walletId: string) => Promise<void>;
  disconnectWallet: () => void;
  walletOptions: WalletOption[];
  zkLoginState: ZkLoginState;
  network: 'mainnet' | 'testnet' | 'devnet';
  processJwt: (jwt: string) => Promise<void>;
}

// 지갑 옵션 목록
const walletOptions: WalletOption[] = [
  {
    id: 'google',
    name: 'Google',
    icon: '/images/wallet/google_icon.svg',
    description: 'Login with Google account',
    isAvailable: true,
  },
  {
    id: 'facebook',
    name: 'Facebook',
    icon: '/images/wallet/facebook_icon.svg',
    description: 'Login with Facebook account',
    isAvailable: true,
  },
  {
    id: 'kakao',
    name: 'Kakao',
    icon: '/images/wallet/kakao_icon.svg',
    description: 'Login with Kakao account',
    isAvailable: true,
  },
];

// 기본 zkLogin 상태
const defaultZkLoginState: ZkLoginState = {
  ephemeralKeyPair: null,
  maxEpoch: null,
  randomness: null,
  nonce: null,
  jwt: null,
  zkProof: null,
  userSalt: null,
};

// 기본값 생성
const defaultContextValue: WalletContextType = {
  isWalletConnected: false,
  walletAddress: null,
  isConnecting: false,
  suiClient: null,
  balance: null,
  connectWallet: async () => {},
  disconnectWallet: () => {},
  walletOptions,
  zkLoginState: defaultZkLoginState,
  network: 'devnet', // 기본값은 devnet
  processJwt: async () => {}, // processJwt 기본값 추가
};

// Context 생성
const WalletContext = createContext<WalletContextType>(defaultContextValue);

// 컨텍스트 훅
export const useWallet = () => useContext(WalletContext);

interface WalletProviderProps {
  children: ReactNode;
  network?: 'mainnet' | 'testnet' | 'devnet';
}

export const WalletProvider: React.FC<WalletProviderProps> = ({ 
  children, 
  network = 'devnet' 
}) => {
  const [isWalletConnected, setIsWalletConnected] = useState<boolean>(false);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState<boolean>(false);
  const [suiClient, setSuiClient] = useState<SuiClient | null>(null);
  const [balance, setBalance] = useState<string | null>(null);
  const [zkLoginState, setZkLoginState] = useState<ZkLoginState>(defaultZkLoginState);

  // SUI 클라이언트 초기화
  useEffect(() => {
    const client = new SuiClient({ url: getFullnodeUrl(network) });
    setSuiClient(client);
  }, [network]);

  // 로컬 스토리지에서 이전 인증 정보 확인
  useEffect(() => {
    const checkConnection = async () => {
      if (!suiClient) return;

      try {
        // 세션 스토리지에서 인증 정보 가져오기
        const savedState = sessionStorage.getItem('zkLoginState');
        const savedAddress = sessionStorage.getItem('walletAddress');

        if (savedState && savedAddress) {
          const parsedState = JSON.parse(savedState);
          
          // 저장된 ephemeralKeyPair 재생성
          let ephemeralKeyPair = null;
          if (parsedState.ephemeralPrivateKey) {
            const privateKeyBytes = new Uint8Array(
              parsedState.ephemeralPrivateKey.split(',').map(Number)
            );
            ephemeralKeyPair = Ed25519Keypair.fromSecretKey(privateKeyBytes);
          }

          // zkLoginState 복원
          setZkLoginState({
            ...parsedState,
            ephemeralKeyPair
          });
          
          setWalletAddress(savedAddress);
          setIsWalletConnected(true);

          // 잔액 조회
          try {
            const { totalBalance } = await suiClient.getBalance({
              owner: savedAddress
            });
            setBalance(totalBalance);
          } catch (error) {
            console.error('잔액 조회 실패:', error);
          }
        }
      } catch (error) {
        console.error('자동 지갑 연결 실패:', error);
      }
    };

    if (suiClient) {
      checkConnection();
    }
  }, [suiClient]);

  // zkLogin 프로세스 시작 함수
  const startZkLogin = async (provider: string) => {
    if (!suiClient) return;

    try {
      // 1. 임시 키 페어 생성
      const ephemeralKeyPair = new Ed25519Keypair();
      
      // 2. 현재 epoch 정보 가져오기
      const { epoch, epochDurationMs } = await suiClient.getLatestSuiSystemState();
      const maxEpoch = Number(epoch) + 2; // 2 epoch 동안 유효
      
      // 3. nonce 생성
      const randomness = generateRandomness();
      const nonce = generateNonce(ephemeralKeyPair.getPublicKey(), maxEpoch, randomness);
      
      // 4. zkLoginState 업데이트
      setZkLoginState({
        ephemeralKeyPair,
        maxEpoch,
        randomness,
        nonce,
        jwt: null,
        zkProof: null,
        userSalt: null
      });
      
      // 5. 적절한 OAuth URL 구성
      let authUrl = '';
      let clientId = ''; // 실제 클라이언트 ID로 대체 필요
      const redirectUrl = window.location.origin + '/callback'; // 리다이렉션 URL 설정

      alert(import.meta.env.VITE_GOOGLE_CLIENT_ID)
      switch (provider) {
        case 'google':
          clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID || ''; // Google 클라이언트 ID
          authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&response_type=id_token&redirect_uri=${redirectUrl}&scope=openid&nonce=${nonce}`;
          break;
        case 'facebook':
          clientId = ''; // Facebook 클라이언트 ID
          authUrl = `https://www.facebook.com/v17.0/dialog/oauth?client_id=${clientId}&redirect_uri=${redirectUrl}&scope=openid&nonce=${nonce}&response_type=id_token`;
          break;
        case 'kakao':
          clientId = ''; // Kakao 클라이언트 ID
          authUrl = `https://kauth.kakao.com/oauth/authorize?client_id=${clientId}&redirect_uri=${redirectUrl}&response_type=code&scope=openid&nonce=${nonce}`;
          break;
        default:
          throw new Error(`${provider} 제공자는 지원되지 않습니다.`);
      }
      
      // 6. 임시 키 페어 정보를 세션 스토리지에 저장
      const ephemeralPrivateKey = Array.from(ephemeralKeyPair.getSecretKey());
      sessionStorage.setItem('zkLoginState', JSON.stringify({
        ephemeralPrivateKey,
        maxEpoch,
        randomness,
        nonce,
        provider
      }));
      
      // 7. OAuth 로그인 페이지로 이동
      window.location.href = authUrl;
      
    } catch (error) {
      console.error('zkLogin 시작 오류:', error);
      setIsConnecting(false);
    }
  };

  // 리다이렉트 후 JWT 처리 함수
  const processJwt = async (jwt: string) => {
    if (!suiClient || !zkLoginState.ephemeralKeyPair || !zkLoginState.nonce) {
      console.error('필요한 zkLogin 상태가 없습니다.');
      return;
    }

    try {
      // 1. JWT 디코드
      const decodedJwt = jwtDecode(jwt) as JwtPayload;
      
      // 2. userSalt 얻기 (실제 구현에서는 개발자 백엔드 API를 호출해야 함)
      // 여기서는 예시로 단순한 값을 사용
      const userSalt = '1000000'; // 실제 구현에서는 백엔드에서 가져와야 함
      
      // 3. 주소 계산
      const address = jwtToAddress(jwt, userSalt);
      
      // 4. ZK 증명 가져오기 (실제 구현에서는 ZK 증명 서비스 호출)
      // 여기서는 가짜 데이터를 사용
      const zkProof = { /* 실제 ZK 증명 데이터 */ };
      
      // 5. 상태 업데이트
      setZkLoginState(prevState => ({
        ...prevState,
        jwt,
        userSalt,
        zkProof
      }));
      
      setWalletAddress(address);
      setIsWalletConnected(true);
      
      // 6. 세션 스토리지 업데이트
      sessionStorage.setItem('walletAddress', address);
      const currentState = JSON.parse(sessionStorage.getItem('zkLoginState') || '{}');
      sessionStorage.setItem('zkLoginState', JSON.stringify({
        ...currentState,
        jwt,
        userSalt,
        zkProof
      }));
      
      // 7. 잔액 조회
      try {
        const { totalBalance } = await suiClient.getBalance({
          owner: address
        });
        setBalance(totalBalance);
      } catch (error) {
        console.error('잔액 조회 실패:', error);
      }
      
    } catch (error) {
      console.error('JWT 처리 오류:', error);
    } finally {
      setIsConnecting(false);
    }
  };

  // 지갑 연결 함수
  const connectWallet = async (walletId: string) => {
    setIsConnecting(true);

    try {
      await startZkLogin(walletId);
    } catch (error) {
      console.error('지갑 연결 중 오류 발생:', error);
      setIsConnecting(false);
    }
  };

  // 지갑 연결 해제 함수
  const disconnectWallet = () => {
    setWalletAddress(null);
    setIsWalletConnected(false);
    setBalance(null);
    setZkLoginState(defaultZkLoginState);
    
    // 세션 스토리지에서 데이터 삭제
    sessionStorage.removeItem('zkLoginState');
    sessionStorage.removeItem('walletAddress');
  };

  // 컨텍스트 값
  const value = {
    isWalletConnected,
    walletAddress,
    isConnecting,
    suiClient,
    balance,
    connectWallet,
    disconnectWallet,
    walletOptions,
    zkLoginState,
    network,
    processJwt,
  };

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
};
