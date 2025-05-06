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

// JWT payload type definition
interface JwtPayload {
  iss?: string;
  sub?: string; // Subject ID
  aud?: string[] | string;
  exp?: number;
  nbf?: number;
  iat?: number;
  jti?: string;
}

// Wallet option type definition
export interface WalletOption {
  id: string;
  name: string;
  icon: string;
  description: string;
  isAvailable: boolean;
}

// ZkLogin state interface
interface ZkLoginState {
  ephemeralKeyPair: Ed25519Keypair | null;
  maxEpoch: number | null;
  randomness: string | null;
  nonce: string | null;
  jwt: string | null;
  zkProof: any | null; // Should be updated with actual zkProof type
  userSalt: string | null;
}

// Context type definition
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

// Wallet options list
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
    isAvailable: false,
  },
  {
    id: 'kakao',
    name: 'Kakao',
    icon: '/images/wallet/kakao_icon.png',
    description: 'Login with Kakao account',
    isAvailable: true,
  },
];

// Default zkLogin state
const defaultZkLoginState: ZkLoginState = {
  ephemeralKeyPair: null,
  maxEpoch: null,
  randomness: null,
  nonce: null,
  jwt: null,
  zkProof: null,
  userSalt: null,
};

// Default context value
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
  network: 'devnet', // Default is devnet
  processJwt: async () => {}, // Default processJwt function
};

// Create context
const WalletContext = createContext<WalletContextType>(defaultContextValue);

// Context hook
export const useWallet = () => useContext(WalletContext);

interface WalletProviderProps {
  children: ReactNode;
  network?: 'mainnet' | 'testnet' | 'devnet';
}

export const CustomWalletProvider: React.FC<WalletProviderProps> = ({ 
  children, 
  network = 'devnet' 
}) => {
  const [isWalletConnected, setIsWalletConnected] = useState<boolean>(false);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState<boolean>(false);
  const [suiClient, setSuiClient] = useState<SuiClient | null>(null);
  const [balance, setBalance] = useState<string | null>(null);
  const [zkLoginState, setZkLoginState] = useState<ZkLoginState>(defaultZkLoginState);

  // Initialize SUI client
  useEffect(() => {
    const client = new SuiClient({ url: getFullnodeUrl(network) });
    setSuiClient(client);
  }, [network]);

  // Check for previous authentication in session storage
  useEffect(() => {
    const checkConnection = async () => {
      if (!suiClient) return;

      try {
        // Get authentication info from session storage
        const savedState = sessionStorage.getItem('zkLoginState');
        const savedAddress = sessionStorage.getItem('walletAddress');

        if (savedState && savedAddress) {
          const parsedState = JSON.parse(savedState);
          
          // Recreate stored ephemeralKeyPair
          let ephemeralKeyPair = null;
          if (parsedState.ephemeralPrivateKey) {
            const privateKeyBytes = new Uint8Array(
              parsedState.ephemeralPrivateKey.split(',').map(Number)
            );
            ephemeralKeyPair = Ed25519Keypair.fromSecretKey(privateKeyBytes);
          }

          // Restore zkLoginState
          setZkLoginState({
            ...parsedState,
            ephemeralKeyPair
          });
          
          setWalletAddress(savedAddress);
          setIsWalletConnected(true);

          // Get balance
          try {
            const { totalBalance } = await suiClient.getBalance({
              owner: savedAddress
            });
            setBalance(totalBalance);
          } catch (error) {
            console.error('Failed to get balance:', error);
          }
        }
      } catch (error) {
        console.error('Automatic wallet connection failed:', error);
      }
    };

    if (suiClient) {
      checkConnection();
    }
  }, [suiClient]);

  // Start zkLogin process
  const startZkLogin = async (provider: string) => {
    if (!suiClient) return;

    try {
      // 1. Generate ephemeral key pair
      const ephemeralKeyPair = new Ed25519Keypair();
      
      // 2. Get current epoch info
      const { epoch, epochDurationMs } = await suiClient.getLatestSuiSystemState();
      const maxEpoch = Number(epoch) + 2; // Valid for 2 epochs
      
      // 3. Generate nonce
      const randomness = generateRandomness();
      const nonce = generateNonce(ephemeralKeyPair.getPublicKey(), maxEpoch, randomness);
      
      // 4. Update zkLoginState
      setZkLoginState({
        ephemeralKeyPair,
        maxEpoch,
        randomness,
        nonce,
        jwt: null,
        zkProof: null,
        userSalt: null
      });
      
      // 5. Configure OAuth URL
      let authUrl = '';
      let clientId = ''; // Should be replaced with actual client ID
      const redirectUrl = window.location.origin + '/callback'; // Set redirect URL

      switch (provider) {
        case 'google':
          clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID || ''; // Google client ID
          authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&response_type=id_token&redirect_uri=${redirectUrl}&scope=openid&nonce=${nonce}`;
          break;
        case 'facebook':
          clientId = import.meta.env.VITE_FACEBOOK_CLIENT_ID || ''; // Facebook client ID
          authUrl = `https://www.facebook.com/v17.0/dialog/oauth?client_id=${clientId}&redirect_uri=${redirectUrl}&scope=openid&nonce=${nonce}&response_type=id_token`;
          break;
        case 'kakao':
          clientId = import.meta.env.VITE_KAKAO_CLIENT_ID || ''; // Kakao client ID
          authUrl = `https://kauth.kakao.com/oauth/authorize?client_id=${clientId}&redirect_uri=${redirectUrl}&response_type=code&scope=openid&nonce=${nonce}`;
          break;
        default:
          throw new Error(`Provider ${provider} is not supported.`);
      }
      
      // 6. Store ephemeral key pair info in session storage
      const ephemeralPrivateKey = Array.from(ephemeralKeyPair.getSecretKey());
      sessionStorage.setItem('zkLoginState', JSON.stringify({
        ephemeralPrivateKey,
        maxEpoch,
        randomness,
        nonce,
        provider
      }));
      
      // 7. Redirect to OAuth login page
      window.location.href = authUrl;
      
    } catch (error) {
      console.error('zkLogin start error:', error);
      setIsConnecting(false);
    }
  };

  // Process JWT after redirect
  const processJwt = async (jwt: string) => {
    if (!suiClient || !zkLoginState.ephemeralKeyPair || !zkLoginState.nonce) {
      console.error('Required zkLogin state is missing.');
      return;
    }

    try {
      // 1. Decode JWT
      const decodedJwt = jwtDecode(jwt) as JwtPayload;
      
      // 2. Get userSalt (in real implementation, should call backend API)
      // Using simple value for example
      const userSalt = '1000000'; // In real implementation, should be fetched from backend
      
      // 3. Calculate address
      const address = jwtToAddress(jwt, userSalt);
      
      // 4. Get ZK proof (in real implementation, should call ZK proving service)
      // Using dummy data here
      const zkProof = { /* Actual ZK proof data */ };
      
      // 5. Update state
      setZkLoginState(prevState => ({
        ...prevState,
        jwt,
        userSalt,
        zkProof
      }));
      
      setWalletAddress(address);
      setIsWalletConnected(true);
      
      // 6. Update session storage
      sessionStorage.setItem('walletAddress', address);
      const currentState = JSON.parse(sessionStorage.getItem('zkLoginState') || '{}');
      sessionStorage.setItem('zkLoginState', JSON.stringify({
        ...currentState,
        jwt,
        userSalt,
        zkProof
      }));
      
      // 7. Get balance
      try {
        const { totalBalance } = await suiClient.getBalance({
          owner: address
        });
        setBalance(totalBalance);
      } catch (error) {
        console.error('Failed to get balance:', error);
      }
      
    } catch (error) {
      console.error('JWT processing error:', error);
    } finally {
      setIsConnecting(false);
    }
  };

  // Connect wallet function
  const connectWallet = async (walletId: string) => {
    setIsConnecting(true);

    try {
      await startZkLogin(walletId);
    } catch (error) {
      console.error('Error connecting wallet:', error);
      setIsConnecting(false);
    }
  };

  // Disconnect wallet function
  const disconnectWallet = () => {
    setWalletAddress(null);
    setIsWalletConnected(false);
    setBalance(null);
    setZkLoginState(defaultZkLoginState);
    
    // Remove data from session storage
    sessionStorage.removeItem('zkLoginState');
    sessionStorage.removeItem('walletAddress');
  };

  // Context value
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
