import React, { useState, useEffect } from 'react';
import { Button } from './ui/button';
import { Wallet, ChevronDown } from 'lucide-react';
import { useWallet } from '@/contexts/wallet-context';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from './ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';

const WalletConnect: React.FC = () => {
  const {
    isWalletConnected,
    walletAddress,
    isConnecting,
    connectWallet,
    disconnectWallet,
    walletOptions,
    balance,
  } = useWallet();

  const [isWalletDialogOpen, setIsWalletDialogOpen] = useState(false);

  // 지갑이 연결되면 다이얼로그를 자동으로 닫음
  useEffect(() => {
    if (isWalletConnected && isWalletDialogOpen) {
      setIsWalletDialogOpen(false);
    }
  }, [isWalletConnected, isWalletDialogOpen]);

  // 지갑 연결 함수 래퍼
  const handleConnectWallet = async (walletId: string) => {
    await connectWallet(walletId);
    // connectWallet 함수 내에서 연결 성공 후 상태가 변경되면 위의 useEffect에서 다이얼로그를 닫음
  };

  return (
    <>
      {/* 지갑 버튼 */}
      <div className="px-4 py-2">
        {!isWalletConnected ? (
          <Button
            variant="outline"
            className="w-full justify-start"
            onClick={() => setIsWalletDialogOpen(true)}
          >
            <Wallet className="mr-2 h-4 w-4" />
            Connect Wallet
          </Button>
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="w-full justify-between">
                <div className="flex items-center">
                  <Wallet className="mr-2 h-4 w-4" />
                  <span className="truncate max-w-28">
                    {walletAddress?.substring(0, 6)}...
                    {walletAddress?.substring(walletAddress.length - 4)}
                  </span>
                </div>
                <ChevronDown className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-48">
              {balance && (
                <div className="px-2 py-1.5 text-sm text-muted-foreground">
                  {parseFloat(balance).toFixed(4)} ETH
                </div>
              )}
              <DropdownMenuItem
                onClick={() => navigator.clipboard.writeText(walletAddress || '')}
                className="cursor-pointer"
              >
                Copy Address
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={disconnectWallet} className="cursor-pointer text-red-500">
                Disconnect
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {/* 지갑 연결 다이얼로그 */}
      <Dialog open={isWalletDialogOpen} onOpenChange={setIsWalletDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Connect Wallet</DialogTitle>
            <DialogDescription>
              Choose a wallet to connect with Ethereum and other blockchains.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            {walletOptions.map((wallet) => (
              <Button
                key={wallet.id}
                variant="outline"
                className="flex justify-start items-center p-6 h-auto"
                onClick={() => wallet.isAvailable && handleConnectWallet(wallet.id)}
                disabled={isConnecting || !wallet.isAvailable}
              >
                <div className="flex items-center gap-4 w-full">
                  <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center overflow-hidden">
                    <img
                      src={wallet.icon}
                      alt={wallet.name}
                      className="w-full h-full object-contain"
                    />
                  </div>
                  <div className="flex flex-col items-start">
                    <span className="font-medium">{wallet.name}</span>
                    <span className="text-sm text-muted-foreground">{wallet.description}</span>
                    {!wallet.isAvailable && (
                      <span className="text-xs text-orange-500 mt-1">준비 중</span>
                    )}
                  </div>
                </div>
              </Button>
            ))}
          </div>
          <DialogFooter className="flex flex-col sm:flex-row sm:justify-end gap-2">
            <Button variant="outline" onClick={() => setIsWalletDialogOpen(false)}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default WalletConnect;
