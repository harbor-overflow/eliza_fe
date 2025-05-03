import type { UUID } from '@elizaos/core';
import { Database, LoaderIcon, MailCheck, MessageSquareShare, Pencil, Download, Share, Upload, FileJson } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAgentMemories, useDeleteMemory, useUpdateMemory, useCreateMemory } from '../hooks/use-query-hooks';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';

import type { Memory } from '@elizaos/core';
import MemoryEditOverlay from './memory-edit-overlay';
import { useToast } from '../hooks/use-toast';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../lib/api';

// Number of items to load per batch
const ITEMS_PER_PAGE = 10;

interface MemoryContent {
  thought?: boolean;
  channelType?: string;
  source?: string;
  text?: string;
  metadata?: {
    fileType?: string;
    title?: string;
    filename?: string;
    path?: string;
    description?: string;
  };
}
// Add type for message content structure based on API response
interface ChatMemoryContent extends MemoryContent {
  text?: string;
  actions?: string[];
  thought?: boolean;
  inReplyTo?: string;
  providers?: string[];
  channelType?: string;
}

enum MemoryType {
  all = 'all',
  messagesReceived = 'messagesReceived',
  messagesSent = 'messagesSent',
  thoughts = 'thoughts',
  facts = 'facts',
}

export function AgentMemoryViewer({ agentId, agentName }: { agentId: UUID; agentName: string }) {
  const [selectedType, setSelectedType] = useState<MemoryType>(MemoryType.all);
  const [editingMemory, setEditingMemory] = useState<Memory | null>(null);
  const [visibleItems, setVisibleItems] = useState(ITEMS_PER_PAGE);
  const [loadingMore, setLoadingMore] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const { mutate: updateMemory } = useUpdateMemory();
  const { mutate: createMemory } = useCreateMemory();

  console.log({ agentName, agentId });

  // Determine if we need to use the 'documents' table for knowledge
  const tableName =
    selectedType === MemoryType.facts
      ? 'facts'
      : selectedType === MemoryType.messagesSent || selectedType === MemoryType.messagesReceived
        ? 'messages'
        : selectedType === MemoryType.all
          ? undefined
          : undefined;

  const { data: memories = [], isLoading, error } = useAgentMemories(agentId, tableName);
  const { mutate: deleteMemory } = useDeleteMemory();

  // Handle scroll to implement infinite loading
  const handleScroll = useCallback(() => {
    if (!scrollContainerRef.current || loadingMore || visibleItems >= filteredMemories.length) {
      return;
    }

    const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
    const scrolledToBottom = scrollTop + clientHeight >= scrollHeight - 100; // 100px buffer

    if (scrolledToBottom) {
      setLoadingMore(true);
      // Add a small delay to simulate loading and prevent too rapid updates
      setTimeout(() => {
        setVisibleItems((prev) => Math.min(prev + ITEMS_PER_PAGE, filteredMemories.length));
        setLoadingMore(false);
      }, 300);
    }
  }, [loadingMore, visibleItems]);
  // Reset visible items when filter changes or new data loads
  useEffect(() => {
    setVisibleItems(ITEMS_PER_PAGE);
  }, []);

  // Set up scroll event listener
  useEffect(() => {
    const scrollContainer = scrollContainerRef.current;
    if (scrollContainer) {
      scrollContainer.addEventListener('scroll', handleScroll);
      return () => scrollContainer.removeEventListener('scroll', handleScroll);
    }
  }, [handleScroll]);

  if (isLoading && (!memories || memories.length === 0)) {
    return <div className="flex items-center justify-center h-40">Loading memories...</div>;
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-40 text-destructive">
        Error loading agent memories
      </div>
    );
  }

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
  };

  const getMemoryIcon = (memory: Memory, content: MemoryContent) => {
    if (memory.entityId === memory.agentId) return <MessageSquareShare className="w-4 h-4" />;
    if (memory.entityId !== memory.agentId) return <MailCheck className="w-4 h-4" />;
    if (content?.thought) return <LoaderIcon className="w-4 h-4" />;
    return <Database className="w-4 h-4" />;
  };

  const handleDelete = (memoryId: string) => {
    if (memoryId && window.confirm('Are you sure you want to delete this memory entry?')) {
      deleteMemory({ agentId, memoryId });
    }
  };

  // Group messages by date for better organization
  const groupMessagesByDate = (messages: Memory[]) => {
    const groups: Record<string, Memory[]> = {};

    for (const memory of messages) {
      const date = new Date(memory.createdAt || 0);
      const dateKey = date.toLocaleDateString();

      if (!groups[dateKey]) {
        groups[dateKey] = [];
      }
      groups[dateKey].push(memory);
    }

    return groups;
  };

  // Filter memories based on selected type
  const filteredMemories = memories.filter((memory: Memory) => {
    if (selectedType === MemoryType.all) {
      return true;
    }

    const content = memory.content as ChatMemoryContent;

    if (selectedType === MemoryType.thoughts) {
      return content?.thought !== undefined;
    }

    if (selectedType === MemoryType.messagesSent) {
      return memory.entityId === memory.agentId;
    }

    if (selectedType === MemoryType.messagesReceived) {
      return memory.entityId !== memory.agentId;
    }

    return true;
  });

  // Get visible subset for infinite scrolling
  const visibleMemories = filteredMemories.slice(0, visibleItems);
  const hasMoreToLoad = visibleItems < filteredMemories.length;

  const messageGroups = groupMessagesByDate(visibleMemories);

  // Internal components for better organization
  const LoadingIndicator = () => (
    <div className="flex justify-center p-4">
      {loadingMore ? (
        <div className="flex items-center gap-2">
          <LoaderIcon className="h-4 w-4 animate-spin" />
          <span className="text-sm text-muted-foreground">Loading more...</span>
        </div>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setVisibleItems((prev) => prev + ITEMS_PER_PAGE)}
          className="text-xs"
        >
          Show more
        </Button>
      )}
    </div>
  );

  const EmptyState = () => (
    <div className="text-muted-foreground text-center p-12 flex flex-col items-center gap-3 border-2 border-dashed rounded-lg mt-8">
      <Database className="h-12 w-12 text-muted-foreground opacity-20" />
      <h3 className="text-lg font-medium">No Memories</h3>
      <p className="max-w-md text-sm">
        Messages will appear here once the agent begins communicating.
      </p>
    </div>
  );

  const MemoryCard = ({
    memory,
    index,
    agentName,
  }: {
    memory: Memory;
    index: number;
    agentName: string;
  }) => {
    const content = memory.content as ChatMemoryContent;
    const hasThought = content?.thought;
    const timestamp = formatDate(memory.createdAt || 0);

    // Get entity name with improved logic
    const entityName = memory.metadata?.entityName ? memory.metadata?.entityName : agentName;

    console.log(entityName, memory.id, agentName);

    return (
      <div
        key={memory.id || index}
        className="border rounded-md p-3 mb-3 bg-card hover:bg-accent/10 transition-colors relative group"
      >
        {/* Action buttons */}
        {memory.id && (
          <div className="absolute top-2 right-2 flex space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <Button
              variant="ghost"
              size="icon"
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                setEditingMemory(memory);
              }}
              title="Edit memory"
              className="h-7 w-7 hover:bg-muted"
            >
              <Pencil className="h-4 w-4" />
            </Button>
          </div>
        )}

        {/* Memory header - Author and timestamp */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium flex items-center gap-1.5">
              {getMemoryIcon(memory, content)}
              <span className="font-semibold">{entityName}</span>
            </span>
            {content?.actions && content.actions.length > 0 && (
              <Badge variant="outline" className="text-xs">
                {content.actions.join(', ')}
              </Badge>
            )}
            {content.source && (
              <Badge variant="outline" className="text-xs">
                {content.source}
              </Badge>
            )}
          </div>

          <Badge variant="secondary" className="text-xs group-hover:mr-8 transition-all">
            {timestamp}
          </Badge>
        </div>

        {/* Message content */}
        {content?.text && (
          <div className="bg-muted/30 px-3 py-2 rounded mb-2">
            <p className="text-sm whitespace-pre-wrap">{content.text}</p>
          </div>
        )}

        {/* Thought content */}
        {hasThought && (
          <div className="border-t pt-2 mt-2">
            <div className="flex items-center gap-1.5 mb-1">
              <LoaderIcon className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs font-medium text-muted-foreground">Thought Process</span>
            </div>
            <div className="bg-muted/20 px-3 py-2 rounded text-muted-foreground">
              <p className="text-xs italic whitespace-pre-wrap">{content.thought}</p>
            </div>
          </div>
        )}

        {/* Show providers if available */}
        {content?.providers && content.providers.length > 0 && (
          <div className="mt-2">
            <div className="flex items-center gap-1.5 mb-1">
              <span className="text-xs font-medium text-muted-foreground">Providers</span>
            </div>
            <div className="flex flex-wrap gap-1 p-2 bg-muted/20 rounded text-muted-foreground">
              {content.providers.map((provider) => (
                <Badge key={provider} variant="outline" className="text-[10px] bg-muted/40">
                  {provider}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Memory metadata */}
        <div className="mt-2 grid gap-2">
          {memory.id && (
            <div className="text-xs bg-muted/40 px-2 py-1 rounded flex items-center">
              <span className="font-semibold text-muted-foreground mr-1">ID:</span>
              <code className="text-[11px] font-mono">{memory.id}</code>
            </div>
          )}

          {content?.inReplyTo && (
            <div className="text-xs bg-muted/40 px-2 py-1 rounded flex items-center">
              <span className="font-semibold text-muted-foreground mr-1">In Reply To:</span>
              <code className="text-[11px] font-mono">{content.inReplyTo}</code>
            </div>
          )}

          {memory.metadata && Object.keys(memory.metadata).length > 0 && (
            <details className="text-xs">
              <summary className="cursor-pointer font-semibold text-muted-foreground hover:text-foreground">
                Metadata
              </summary>
              <div className="bg-muted/30 px-2 py-1 rounded mt-1 max-h-32 overflow-y-auto">
                <pre className="text-[11px] font-mono">
                  {JSON.stringify(memory.metadata, null, 2)}
                </pre>
              </div>
            </details>
          )}
        </div>
      </div>
    );
  };

  // Export memories to a JSON file
  const exportMemories = () => {
    try {
      // JSON 문자열로 변환
      const jsonData = JSON.stringify(filteredMemories, null, 2);
      
      // Blob 생성
      const blob = new Blob([jsonData], { type: 'application/json' });
      
      // 다운로드 URL 생성
      const url = URL.createObjectURL(blob);
      
      // 다운로드 링크 생성 및 클릭
      const link = document.createElement('a');
      const fileName = `${agentName}-memories-${new Date().toISOString().split('T')[0]}.json`;
      link.href = url;
      link.download = fileName;
      link.click();
      
      // 자원 정리
      URL.revokeObjectURL(url);
      
      toast({
        title: 'Export Successful',
        description: `${filteredMemories.length} memories saved to ${fileName}`,
      });
    } catch (error) {
      console.error('Error exporting memories:', error);
      toast({
        title: 'Export Failed',
        description: 'An error occurred while exporting memories.',
        variant: 'destructive',
      });
    }
  };

  // 파일 선택 핸들러
  const handleFileSelect = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  // 파일 변경 핸들러
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    await processFile(files[0]);
  };

  // 드래그 앤 드롭 이벤트 핸들러
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingOver(true);
  };

  const handleDragLeave = () => {
    setIsDraggingOver(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingOver(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      await processFile(e.dataTransfer.files[0]);
    }
  };

  // 파일 처리 함수
  const processFile = async (file: File) => {
    if (file.type !== 'application/json') {
      toast({
        title: 'Unsupported File Format',
        description: 'Only JSON files are allowed.',
        variant: 'destructive',
      });
      return;
    }

    setIsImporting(true);
    
    try {
      const fileContent = await file.text();
      const importedMemories = JSON.parse(fileContent);
      
      if (!Array.isArray(importedMemories)) {
        throw new Error('Invalid memory data format.');
      }

      // ID가 없는 메모리 검증
      const invalidMemories = importedMemories.filter(memory => !memory.id);
      if (invalidMemories.length > 0) {
        throw new Error('All memories must have an ID.');
      }

      // 기존 메모리 ID 맵 생성
      const existingMemoryIds = new Set(memories.map((memory: Memory) => memory.id));
      
      // 순차적으로 각 메모리 처리
      let updateCount = 0;
      let createCount = 0;
      let errorCount = 0;

      const processPromises = importedMemories.map(async (memory: Memory) => {
        try {
          if (existingMemoryIds.has(memory.id)) {
            // 기존 메모리 업데이트
            updateMemory(
              {
                agentId,
                memoryId: memory.id,
                memoryData: memory
              },
              {
                onSuccess: () => {
                  updateCount++;
                },
                onError: () => {
                  errorCount++;
                }
              }
            );
          } else {
            // 새 메모리 생성 (ID가 있지만 현재 에이전트에 존재하지 않는 경우)
            // agentId와 entityId 확인
            const newMemory: Partial<Memory> = {
              ...memory,
              agentId, // 현재 에이전트 ID 할당
              entityId: memory.entityId || agentId // entityId가 없으면 agentId 사용
            };

            createMemory(
              {
                agentId,
                memoryData: newMemory
              },
              {
                onSuccess: () => {
                  createCount++;
                },
                onError: () => {
                  errorCount++;
                }
              }
            );
          }
        } catch (error) {
          console.error(`Error processing memory ${memory.id}:`, error);
          errorCount++;
        }
      });

      await Promise.all(processPromises);

      // 성공 메시지 표시
      toast({
        title: 'Import Completed',
        description: `${updateCount} memories updated, ${createCount} memories created, ${errorCount} failed`,
      });
      
      setIsImportDialogOpen(false);
    } catch (error) {
      console.error('Error processing file:', error);
      toast({
        title: 'Import Failed',
        description: error instanceof Error ? error.message : 'An error occurred while importing memories.',
        variant: 'destructive',
      });
    } finally {
      setIsImporting(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-100px)] min-h-[400px] w-full">
      <div className="flex flex-col gap-2 mb-4 px-4 pt-4 flex-none border-b pb-3">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-medium">Memories</h3>
            {!isLoading && (
              <Badge variant="secondary" className="ml-2">
                {filteredMemories.length} memories
              </Badge>
            )}
          </div>
          <Select
              value={selectedType}
              onValueChange={(value) => setSelectedType(value as MemoryType)}
            >
              <SelectTrigger className="w-40">
                <SelectValue placeholder="Filter memories" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={MemoryType.all}>All Messages</SelectItem>
                <SelectItem value={MemoryType.messagesSent}>Agent Messages</SelectItem>
                <SelectItem value={MemoryType.messagesReceived}>User Messages</SelectItem>
                <SelectItem value={MemoryType.thoughts}>With Thoughts</SelectItem>
                <SelectItem value={MemoryType.facts}>Facts</SelectItem>
              </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="flex items-center gap-1" onClick={exportMemories}>
            <Share className="h-4 w-4" />
            Export Memories
          </Button>
          <Button variant="outline" size="sm" className="flex items-center gap-1" onClick={() => setIsImportDialogOpen(true)}>
            <Download className="h-4 w-4" />
            Import Memories
          </Button>
        </div>
      </div>
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto px-4 pb-4 h-[calc(100vh-60px)]"
      >
        {filteredMemories.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="space-y-4">
            {/* Group messages by date */}
            {Object.entries(messageGroups).map(([date, messages]) => (
              <div key={date} className="mb-4">
                <div className="sticky top-0 z-10 bg-background/80 backdrop-blur-sm mb-2 pb-1 pt-2">
                  <Badge variant="outline" className="text-xs">
                    {date}
                  </Badge>
                </div>
                <div className="space-y-1">
                  {messages.map((memory: Memory, index: number) => (
                    <MemoryCard
                      key={memory.id || index}
                      memory={memory}
                      index={index}
                      agentName={agentName}
                    />
                  ))}
                </div>
              </div>
            ))}
            {hasMoreToLoad && <LoadingIndicator />}
          </div>
        )}
      </div>

      {editingMemory && (
        <MemoryEditOverlay
          isOpen={!!editingMemory}
          onClose={() => setEditingMemory(null)}
          memory={editingMemory}
          agentId={agentId}
        />
      )}

      {/* Import Memories Dialog */}
      <Dialog open={isImportDialogOpen} onOpenChange={setIsImportDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Import Memories</DialogTitle>
            <DialogDescription>
              Upload a JSON file to import memories for this agent.
            </DialogDescription>
          </DialogHeader>
          
          <div 
            className={`mt-4 border-2 border-dashed rounded-lg p-8 text-center ${
              isDraggingOver ? 'border-primary bg-primary/10' : 'border-muted-foreground/25'
            }`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <FileJson className="mx-auto h-12 w-12 text-muted-foreground/50 mb-4" />
            <h3 className="font-medium text-lg mb-2">Drag and drop a file or</h3>
            <Button 
              variant="outline" 
              onClick={handleFileSelect}
              disabled={isImporting}
              className="mt-2"
            >
              {isImporting ? (
                <>
                  <LoaderIcon className="mr-2 h-4 w-4 animate-spin" />
                  Importing...
                </>
              ) : (
                <>
                  <Upload className="mr-2 h-4 w-4" />
                  Select File
                </>
              )}
            </Button>
            <input
              type="file"
              ref={fileInputRef}
              className="hidden"
              accept="application/json"
              onChange={handleFileChange}
            />
            <p className="text-xs text-muted-foreground mt-4">
              Only JSON memory files are supported
            </p>
          </div>
          
          <DialogFooter className="flex justify-between mt-4">
            <Button variant="outline" onClick={() => setIsImportDialogOpen(false)}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
