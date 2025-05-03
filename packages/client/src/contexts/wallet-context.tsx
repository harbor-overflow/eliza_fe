import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { ethers } from 'ethers';

// 지갑 타입 정의
export interface WalletOption {
  id: string;
  name: string;
  icon: string;
  description: string;
  isAvailable: boolean;
}

// 컨텍스트 타입 정의
interface WalletContextType {
  isWalletConnected: boolean;
  walletAddress: string | null;
  isConnecting: boolean;
  provider: ethers.BrowserProvider | null;
  signer: ethers.JsonRpcSigner | null;
  chainId: number | null;
  balance: string | null;
  connectWallet: (walletId: string) => Promise<void>;
  disconnectWallet: () => void;
  walletOptions: WalletOption[];
}

// 지갑 옵션 목록
const walletOptions: WalletOption[] = [
  {
    id: 'metamask',
    name: 'MetaMask',
    icon: '/images/wallet/metamask_icon.svg',
    description: 'Most popular Ethereum wallet',
    isAvailable: true,
  },
  {
    id: 'phantom',
    name: 'Phantom',
    icon: '/images/wallet/phantom_icon.svg',
    description: 'Wallet for Solana ecosystem (Coming soon)',
    isAvailable: false,
  },
];

// 기본값 생성
const defaultContextValue: WalletContextType = {
  isWalletConnected: false,
  walletAddress: null,
  isConnecting: false,
  provider: null,
  signer: null,
  chainId: null,
  balance: null,
  connectWallet: async () => {},
  disconnectWallet: () => {},
  walletOptions,
};

// Context 생성
const WalletContext = createContext<WalletContextType>(defaultContextValue);

// 컨텍스트 훅
export const useWallet = () => useContext(WalletContext);

interface WalletProviderProps {
  children: ReactNode;
}

export const WalletProvider: React.FC<WalletProviderProps> = ({ children }) => {
  const [isWalletConnected, setIsWalletConnected] = useState<boolean>(false);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState<boolean>(false);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [signer, setSigner] = useState<ethers.JsonRpcSigner | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [balance, setBalance] = useState<string | null>(null);

  // 이미 연결된 지갑이 있는지 확인
  useEffect(() => {
    const checkConnection = async () => {
      if (typeof window !== 'undefined' && (window as any).ethereum) {
        try {
          // 이미 연결된 계정이 있는지 확인
          const ethereum = (window as any).ethereum;
          const accounts = await ethereum.request({ method: 'eth_accounts' });

          if (accounts.length > 0) {
            const newProvider = new ethers.BrowserProvider(ethereum);
            const newSigner = await newProvider.getSigner();
            const address = await newSigner.getAddress();
            const network = await newProvider.getNetwork();
            const chainId = Number(network.chainId);
            const balance = await newProvider.getBalance(address);

            setProvider(newProvider);
            setSigner(newSigner);
            setWalletAddress(address);
            setIsWalletConnected(true);
            setChainId(chainId);
            setBalance(ethers.formatEther(balance));
          }
        } catch (error) {
          console.error('자동 지갑 연결 실패:', error);
        }
      }
    };

    checkConnection();
  }, []);

  // 계정 변경 이벤트 리스너
  useEffect(() => {
    if (typeof window !== 'undefined' && (window as any).ethereum) {
      const ethereum = (window as any).ethereum;

      const handleAccountsChanged = async (accounts: string[]) => {
        if (accounts.length === 0) {
          // 연결 해제
          disconnectWallet();
        } else if (accounts[0] !== walletAddress) {
          // 계정 변경
          try {
            const newProvider = new ethers.BrowserProvider(ethereum);
            const newSigner = await newProvider.getSigner();
            const address = accounts[0];
            const balance = await newProvider.getBalance(address);

            setProvider(newProvider);
            setSigner(newSigner);
            setWalletAddress(address);
            setIsWalletConnected(true);
            setBalance(ethers.formatEther(balance));
          } catch (error) {
            console.error('계정 변경 처리 실패:', error);
          }
        }
      };

      const handleChainChanged = async (chainIdHex: string) => {
        // 체인 ID가 변경되면 페이지 새로고침이 권장됨
        window.location.reload();
      };

      const handleDisconnect = () => {
        disconnectWallet();
      };

      // 이벤트 리스너 등록
      ethereum.on('accountsChanged', handleAccountsChanged);
      ethereum.on('chainChanged', handleChainChanged);
      ethereum.on('disconnect', handleDisconnect);

      // 컴포넌트 언마운트 시 이벤트 리스너 해제
      return () => {
        ethereum.removeListener('accountsChanged', handleAccountsChanged);
        ethereum.removeListener('chainChanged', handleChainChanged);
        ethereum.removeListener('disconnect', handleDisconnect);
      };
    }
  }, [walletAddress]);

  // 지갑 연결 함수
  const connectWallet = async (walletId: string) => {
    setIsConnecting(true);

    try {
      // 메타마스크 연결 로직
      if (walletId === 'metamask') {
        if (typeof window !== 'undefined' && (window as any).ethereum) {
          try {
            const ethereum = (window as any).ethereum;
            // ethers.js를 사용한 메타마스크 연결
            const newProvider = new ethers.BrowserProvider(ethereum);

            // 사용자에게 계정 접근 권한 요청
            const newSigner = await newProvider.getSigner();
            const address = await newSigner.getAddress();

            // 네트워크 정보 가져오기
            const network = await newProvider.getNetwork();
            const chainIdValue = Number(network.chainId);

            // 계정 잔액 가져오기
            const balanceValue = await newProvider.getBalance(address);
            const etherBalance = ethers.formatEther(balanceValue);

            // 상태 업데이트
            setProvider(newProvider);
            setSigner(newSigner);
            setWalletAddress(address);
            setIsWalletConnected(true);
            setChainId(chainIdValue);
            setBalance(etherBalance);

            console.log('Connected to network:', network.name);
            console.log('Account balance:', etherBalance, 'ETH');
          } catch (error) {
            console.error('사용자가 메타마스크 연결을 거부했습니다:', error);
            alert('메타마스크 연결이 거부되었습니다. 다시 시도해주세요.');
          }
        } else {
          // 메타마스크가 없는 경우
          alert('MetaMask가 설치되어 있지 않습니다. MetaMask를 설치해주세요.');
        }
      }
      // 다른 지갑 연결 로직은 지원하지 않음
    } catch (error) {
      console.error('지갑 연결 중 오류 발생:', error);
    } finally {
      setIsConnecting(false);
    }
  };

  // 지갑 연결 해제 함수
  const disconnectWallet = () => {
    setWalletAddress(null);
    setIsWalletConnected(false);
    setProvider(null);
    setSigner(null);
    setChainId(null);
    setBalance(null);
  };

  // 컨텍스트 값
  const value = {
    isWalletConnected,
    walletAddress,
    isConnecting,
    provider,
    signer,
    chainId,
    balance,
    connectWallet,
    disconnectWallet,
    walletOptions,
  };

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
};
