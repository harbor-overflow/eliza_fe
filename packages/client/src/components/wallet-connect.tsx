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

import { ConnectButton, useCurrentAccount, useSuiClientQuery } from '@mysten/dapp-kit';
import '@mysten/dapp-kit/dist/index.css';

const WalletConnectContent = () => {
  const account = useCurrentAccount();

  return (
    <div className="flex flex-col gap-4">
      <ConnectButton />
      
      {account && (
        <div className="flex flex-col gap-2">
          <div>Connected to: {account.address}</div>
          <OwnedObjects address={account.address} />
        </div>
      )}
    </div>
  );
};

const OwnedObjects = ({ address }: { address: string }) => {
  const { data } = useSuiClientQuery('getOwnedObjects', {
    owner: address,
  });

  if (!data) {
    return <div>Loading objects...</div>;
  }

  return (
    <div className="mt-4">
      <h3 className="text-lg font-semibold mb-2">Owned Objects</h3>
      <ul className="list-disc list-inside">
        {data.data.map((object) => {
          if (!object.data?.objectId) return null;
          return (
            <li key={object.data.objectId}>
              <a 
                href={`https://explorer.sui.io/object/${object.data.objectId}?network=devnet`} 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-blue-600 hover:underline"
              >
                {object.data.objectId}
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
};

const WalletConnect: React.FC = () => {
  const {
    isWalletConnected,
    walletAddress,
    isConnecting,
    connectWallet,
    disconnectWallet,
    walletOptions,
    balance,
    network,
  } = useWallet();

  const [isWalletDialogOpen, setIsWalletDialogOpen] = useState(false);

  // Automatically close dialog when wallet is connected
  useEffect(() => {
    if (isWalletConnected && isWalletDialogOpen) {
      setIsWalletDialogOpen(false);
    }
  }, [isWalletConnected, isWalletDialogOpen]);

  // Wallet connection function wrapper
  const handleConnectWallet = async (walletId: string) => {
    await connectWallet(walletId);
    // The connectWallet function performs OAuth redirection
  };

  return (
    <>
      {/* Wallet button */}
      <div className="px-4 py-2">
        {!isWalletConnected ? (
          <Button
            variant="outline"
            className="w-full justify-start"
            onClick={() => setIsWalletDialogOpen(true)}
          >
            <Wallet className="mr-2 h-4 w-4" />
            Connect SUI Wallet
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
                  {parseFloat(balance).toFixed(4)} SUI
                </div>
              )}
              <div className="px-2 py-1.5 text-xs text-muted-foreground">
                {network.charAt(0).toUpperCase() + network.slice(1)}
              </div>
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

      {/* Wallet connection dialog */}
      <Dialog open={isWalletDialogOpen} onOpenChange={setIsWalletDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Connect SUI Wallet</DialogTitle>
            <DialogDescription>
              Choose a social login option below to connect to the SUI blockchain.
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
                    <span className="font-medium">Login with {wallet.name}</span>
                    <span className="text-sm text-muted-foreground">{wallet.description}</span>
                    {!wallet.isAvailable && (
                      <span className="text-xs text-orange-500 mt-1">Coming soon</span>
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
export { WalletConnectContent };