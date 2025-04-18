import React, { useState, useEffect, useRef } from 'react';
import { ArrowLeft, Send, X, Paperclip } from 'lucide-react';
import { Message } from '../types';
import ContextMenuComponent from './ContextMenuComponent';
import UserProfileComponent from './UserProfileComponent';
import ConfirmModal from './ConfirmModal';
import { useLanguage } from '../contexts/LanguageContext';
import { formatDateLabel, formatTime } from '../utils/dateFormatters';

interface ChatComponentProps {
  chatId: number;
  chatName: string;
  username: string;
  interlocutorDeleted: boolean;
  onBack: () => void;
}

const BASE_URL = "http://192.168.178.29:8000";
const WS_URL = "ws://192.168.178.29:8000";
const DEFAULT_AVATAR = "/static/avatars/default.jpg";

const ChatComponent: React.FC<ChatComponentProps> = ({
  chatId,
  chatName,
  username,
  interlocutorDeleted,
  onBack,
}) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [messageInput, setMessageInput] = useState('');
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; messageId: number; isMine: boolean } | null>(null);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editingMessage, setEditingMessage] = useState<Message | null>(null);
  const [selectedUser, setSelectedUser] = useState<string | null>(null);
  const [modal, setModal] = useState<{
    type: 'deleteMessage' | 'deleteChat' | 'error' | 'copy' | 'deletedUser';
    message: string;
    onConfirm?: () => void;
  } | null>(null);
  const [highlightedMessageId, setHighlightedMessageId] = useState<number | null>(null);
  const { translations, language } = useLanguage();
  
  const wsRef = useRef<WebSocket | null>(null);
  const chatWindowRef = useRef<HTMLDivElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messageRefs = useRef<{[key: number]: HTMLDivElement | null}>({});
  const token = localStorage.getItem('access_token');
  const hasFetchedMessages = useRef(false);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(event.target as Node) && contextMenu) {
        setContextMenu(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [contextMenu]);

  useEffect(() => {
    const loadMessages = async () => {
      if (hasFetchedMessages.current) return;
      hasFetchedMessages.current = true;
      try {
        const response = await fetch(`${BASE_URL}/messages/history/${chatId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (response.ok) {
          const data = await response.json();
          console.log(`History loaded for chat ${chatId}:`, data);
          setMessages(data.history.map((msg: Message) => ({
            ...msg,
            avatar_url: msg.avatar_url || DEFAULT_AVATAR,
            reply_to: msg.reply_to || null,
            type: msg.type || 'message',
            content: msg.type === 'file' ? (typeof msg.content === 'string' ? JSON.parse(msg.content) : msg.content) : msg.content,
          })));
        } else if (response.status === 401) {
          console.error(`Unauthorized access to chat ${chatId}`);
          setModal({
            type: 'error',
            message: translations.loginRequired,
          });
          setTimeout(onBack, 2000);
        } else {
          const errorText = await response.text();
          console.error(`Failed to load history for chat ${chatId}: ${response.status} ${errorText}`);
          throw new Error(translations.errorLoading);
        }
      } catch (err) {
        console.error(`Error loading messages for chat ${chatId}:`, err);
        setModal({
          type: 'error',
          message: translations.errorLoadingMessages,
        });
      }
    };

    if (token) {
      loadMessages();
      
      if (interlocutorDeleted) {
        console.log('Собеседник удалён, WebSocket не подключается для чата', chatId);
        return;
      }
      
      const connectWebSocket = () => {
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          console.log('WebSocket уже подключён для чата', chatId);
          return;
        }
  
        console.log('Подключение WebSocket для чата', chatId);
        wsRef.current = new WebSocket(`${WS_URL}/ws/chat/${chatId}?token=${token}`);
  
        wsRef.current.onopen = () => {
          console.log('WebSocket успешно подключён к чату', chatId);
        };
  
        wsRef.current.onmessage = (event) => {
          let parsedData;
          try {
            parsedData = JSON.parse(event.data);
          } catch (error) {
            console.error("Received non-JSON message:", event.data);
            return;
          }
  
          console.log(`WebSocket message received for chat ${chatId}:`, parsedData);
          const { type } = parsedData;
  
          if (type === "message") {
            const { username: sender, data, timestamp, avatar_url, is_deleted } = parsedData;
            if (data.chat_id !== chatId) {
              console.log(`Игнорируем сообщение для другого chatId: ${data.chat_id}`);
              return;
            }
            const newMessage = {
              id: data.message_id,
              sender,
              content: data.content,
              timestamp,
              avatar_url: avatar_url || DEFAULT_AVATAR,
              reply_to: data.reply_to || null,
              is_deleted: is_deleted || false,
              type: 'message',
            };
            setMessages((prev) => {
              if (prev.some((msg) => msg.id === newMessage.id)) {
                return prev;
              }
              return [...prev, newMessage];
            });
          } else if (type === "file") {
            const { username: sender, data, timestamp, avatar_url, is_deleted } = parsedData;
            if (data.chat_id !== chatId) {
              console.log(`Игнорируем файл для другого chatId: ${data.chat_id}`);
              return;
            }
            const newMessage = {
              id: data.message_id,
              sender,
              content: {
                file_url: data.file_url,
                file_name: data.file_name,
                file_type: data.file_type,
                file_size: data.file_size,
              },
              timestamp,
              avatar_url: avatar_url || DEFAULT_AVATAR,
              reply_to: data.reply_to || null,
              is_deleted: is_deleted || false,
              type: 'file',
            };
            setMessages((prev) => {
              if (prev.some((msg) => msg.id === newMessage.id)) {
                return prev;
              }
              return [...prev, newMessage];
            });
          } else if (type === "edit") {
            const { message_id, new_content } = parsedData;
            setMessages((prev) =>
              prev.map((msg) => (msg.id === message_id ? { ...msg, content: new_content } : msg))
            );
            setEditingMessage(null);
            setMessageInput('');
          } else if (type === "delete") {
            const { message_id } = parsedData;
            setMessages((prev) => prev.filter((msg) => msg.id !== message_id));
          } else if (type === "chat_deleted") {
            const { chat_id } = parsedData;
            if (chat_id === chatId) {
              setModal({
                type: 'error',
                message: translations.chatDeleted,
              });
              setTimeout(onBack, 1000);
            }
          } else if (type === "error") {
            console.error("Server error:", parsedData.message);
            setModal({
              type: 'error',
              message: parsedData.message,
            });
          }
        };
  
        wsRef.current.onerror = (error) => {
          console.error('WebSocket ошибка:', error);
        };
  
        wsRef.current.onclose = (event) => {
          console.log('WebSocket закрыт. Код:', event.code, 'Причина:', event.reason);
          if (event.code !== 1000 && event.code !== 1005) {
            console.log('Переподключение через 1 секунду...');
            setTimeout(connectWebSocket, 1000);
          }
        };
      };
  
      connectWebSocket();
    }

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
      hasFetchedMessages.current = false;
    };
  }, [chatId, token, onBack, interlocutorDeleted, translations]);

  const scrollToBottom = () => {
    if (chatWindowRef.current) {
      chatWindowRef.current.scrollTo({
        top: chatWindowRef.current.scrollHeight,
        behavior: 'smooth',
      });
    }
  };

  const scrollToMessage = (messageId: number) => {
    const messageElement = messageRefs.current[messageId];
    if (messageElement) {
      messageElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setHighlightedMessageId(messageId);
      setTimeout(() => setHighlightedMessageId(null), 1500);
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSendMessage = () => {
    if (!messageInput.trim() || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

    if (editingMessage) {
      wsRef.current.send(JSON.stringify({
        type: "edit",
        message_id: editingMessage.id,
        content: messageInput,
      }));
    } else {
      wsRef.current.send(JSON.stringify({
        type: "message",
        content: messageInput,
        reply_to: replyTo?.id || null,
      }));
    }

    setMessageInput('');
    setReplyTo(null);
    setEditingMessage(null);
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    console.log(`Uploading file: ${file.name}, size: ${file.size}, type: ${file.type}`);

    const formData = new FormData();
    formData.append('file', file);
    formData.append('chat_id', chatId.toString());

    try {
      const response = await fetch(`${BASE_URL}/messages/upload`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`Upload failed: ${errorText}`);
        throw new Error(errorText);
      }

      const data = await response.json();
      console.log('File uploaded:', data);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    } catch (err) {
      console.error('Upload error:', err);
      setModal({
        type: 'error',
        message: translations.errorUploadingFile,
      });
    }
  };

  const handleDeleteChat = () => {
    setModal({
      type: 'deleteChat',
      message: translations.deleteChatConfirm,
      onConfirm: async () => {
        try {
          const response = await fetch(`${BASE_URL}/chats/delete/${chatId}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${token}` },
          });
          if (response.ok) {
            onBack();
          } else {
            throw new Error(translations.errorDeleting);
          }
        } catch (err) {
          setModal({
            type: 'error',
            message: translations.errorDeletingChat,
          });
        }
      },
    });
  };

  const getFormattedDateLabel = (timestamp: string): string => {
    const date = new Date(timestamp);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    
    return formatDateLabel(date, language, today, yesterday);
  };

  const getMessageTime = (timestamp: string): string => {
    return formatTime(timestamp, language);
  };

  const renderMessageContent = (message: Message) => {
    if (message.type === 'file') {
      const { file_url, file_name, file_type } = message.content;
      const fullFileUrl = `${BASE_URL}${file_url}`;

      if (file_type === 'image') {
        return (
          <a href={fullFileUrl} target="_blank" rel="noopener noreferrer">
            <img
              src={fullFileUrl}
              alt={file_name}
              className="max-w-[200px] max-h-[200px] rounded-lg object-cover"
            />
          </a>
        );
      } else if (file_type === 'video') {
        return (
          <video
            src={fullFileUrl}
            controls
            className="max-w-[200px] max-h-[200px] rounded-lg"
          >
            {translations.videoNotSupported}
          </video>
        );
      } else {
        return (
          <a
            href={fullFileUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-500 hover:underline"
          >
            {file_name} ({(message.content.file_size / 1024).toFixed(2)} KB)
          </a>
        );
      }
    }
    return <div>{message.content}</div>;
  };

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 py-4 border-b border-border flex justify-between items-center">
        <div className="flex items-center space-x-4">
          <button
            onClick={onBack}
            className="p-2 hover:bg-accent rounded-full transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h2 className="text-lg font-semibold">{interlocutorDeleted ? translations.deletedUser : chatName}</h2>
        </div>
        <button
          onClick={handleDeleteChat}
          className="text-destructive hover:text-destructive/90 transition-colors"
        >
          {translations.deleteChat}
        </button>
      </div>

      <div
        ref={chatWindowRef}
        className="flex-1 overflow-y-auto p-6 space-y-4"
      >
        {messages.map((message, index) => {
          const isMine = message.sender === username;
          const prevMessage = index > 0 ? messages[index - 1] : null;
          const showDateSeparator = !prevMessage || 
            getFormattedDateLabel(message.timestamp) !== getFormattedDateLabel(prevMessage.timestamp);

          return (
            <React.Fragment key={message.id}>
              {showDateSeparator && (
                <div className="flex justify-center">
                  <div className="px-3 py-1 bg-accent rounded-full text-sm text-accent-foreground">
                    {getFormattedDateLabel(message.timestamp)}
                  </div>
                </div>
              )}
              
              <div
                ref={el => messageRefs.current[message.id] = el}
                className={`flex ${isMine ? 'justify-end' : 'justify-start'} ${
                  highlightedMessageId === message.id ? 'highlighted-message' : ''
                }`}
                onClick={(e) => {
                  if (window.innerWidth < 768) {
                    e.preventDefault();
                    if (!interlocutorDeleted) {
                      const rect = e.currentTarget.getBoundingClientRect();
                      setContextMenu({
                        x: e.clientX,
                        y: e.clientY,
                        messageId: message.id,
                        isMine,
                      });
                    }
                  }
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  if (!interlocutorDeleted) {
                    setContextMenu({
                      x: e.clientX,
                      y: e.clientY,
                      messageId: message.id,
                      isMine,
                    });
                  }
                }}
              >
                <div className={`flex items-end space-x-2 max-w-[70%] ${isMine ? 'flex-row-reverse space-x-reverse' : ''}`}>
                  <img
                    src={`${BASE_URL}${message.avatar_url}`}
                    alt={message.sender}
                    className="w-8 h-8 rounded-full"
                    onClick={() => !interlocutorDeleted && setSelectedUser(message.sender)}
                  />
                  <div className={`group relative flex flex-col ${isMine ? 'items-end' : 'items-start'}`}>
                    {!isMine && (
                      <span className="text-sm text-muted-foreground mb-1">
                        {interlocutorDeleted ? translations.deletedUser : message.sender}
                      </span>
                    )}
                    <div
                      className={`relative px-4 py-2 rounded-2xl ${
                        isMine 
                          ? 'bg-primary text-primary-foreground message-tail-right' 
                          : 'bg-accent text-accent-foreground message-tail-left'
                      } ${message.type === 'file' ? 'max-w-[250px]' : ''}`}
                    >
                      {message.reply_to && (
                        <div 
                          className={`mb-2 p-2 rounded text-sm ${
                            isMine ? 'bg-primary-darker' : 'bg-accent-darker'
                          } cursor-pointer hover:bg-opacity-70 transition-all`}
                          onClick={(e) => {
                            e.stopPropagation();
                            scrollToMessage(message.reply_to);
                          }}
                        >
                          {messages.find(m => m.id === message.reply_to)?.content || translations.messageDeleted}
                        </div>
                      )}
                      {renderMessageContent(message)}
                    </div>
                    <span className="text-xs text-muted-foreground mt-1">
                      {getMessageTime(message.timestamp)}
                    </span>
                  </div>
                </div>
              </div>
            </React.Fragment>
          );
        })}
      </div>

      {!interlocutorDeleted ? (
        <div className="p-4 border-t border-border">
          {(replyTo || editingMessage) && (
            <div className="flex items-center mb-2 p-2 bg-accent rounded-lg">
              <span className="flex-1 text-sm text-muted-foreground">
                {replyTo ? `${translations.replyTo}: ${replyTo.content}` : `${translations.editing}: ${editingMessage!.content}`}
              </span>
              <button
                onClick={() => {
                  setReplyTo(null);
                  setEditingMessage(null);
                  setMessageInput('');
                }}
                className="p-1 hover:bg-accent rounded-full transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}
          
          <div className="flex space-x-2">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="p-2 bg-accent text-accent-foreground rounded-lg hover:bg-accent/90 transition-colors"
            >
              <Paperclip className="w-5 h-5" />
            </button>
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileUpload}
              accept="image/*,video/mp4,video/mov,.pdf,.doc,.docx,.txt"
              className="hidden"
            />
            <input
              type="text"
              value={messageInput}
              onChange={(e) => setMessageInput(e.target.value)}
              placeholder={editingMessage ? translations.editMessagePlaceholder : translations.writeMessage}
              className="flex-1 px-4 py-2 bg-background text-foreground border border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-ring"
              onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
            />
            <button
              onClick={handleSendMessage}
              disabled={!messageInput.trim()}
              className="p-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              <Send className="w-5 h-5" />
            </button>
          </div>
        </div>
      ) : (
        <div className="p-4 border-t border-border">
          <button
            onClick={handleDeleteChat}
            className="w-full p-3 bg-destructive text-destructive-foreground rounded-lg hover:bg-destructive/90 transition-colors"
          >
            {translations.deleteChat}
          </button>
        </div>
      )}

      {contextMenu && (
        <ContextMenuComponent
          ref={contextMenuRef}
          x={contextMenu.x}
          y={contextMenu.y}
          isMine={contextMenu.isMine}
          onEdit={() => {
            const message = messages.find(m => m.id === contextMenu.messageId);
            if (message && message.type === 'message') {
              setEditingMessage(message);
              setMessageInput(message.content);
              setReplyTo(null);
            }
            setContextMenu(null);
          }}
          onDelete={() => {
            setModal({
              type: 'deleteMessage',
              message: translations.deleteMessageConfirm,
              onConfirm: () => {
                if (wsRef.current) {
                  wsRef.current.send(JSON.stringify({
                    type: "delete",
                    message_id: contextMenu.messageId,
                  }));
                }
                setContextMenu(null);
                setModal(null);
              },
            });
          }}
          onCopy={() => {
            const message = messages.find(m => m.id === contextMenu.messageId);
            if (message) {
              const text = message.type === 'file' ? message.content.file_url : message.content;
              navigator.clipboard.writeText(text);
              setModal({
                type: 'copy',
                message: translations.messageCopied,
              });
              setTimeout(() => setModal(null), 1500);
            }
            setContextMenu(null);
          }}
          onReply={() => {
            const message = messages.find(m => m.id === contextMenu.messageId);
            if (message) {
              setReplyTo(message);
              setEditingMessage(null);
              setMessageInput('');
            }
            setContextMenu(null);
          }}
        />
      )}

      {selectedUser && (
        <UserProfileComponent
          username={selectedUser}
          onClose={() => setSelectedUser(null)}
        />
      )}

      {modal && (
        <ConfirmModal
          title={
            modal.type === 'deleteMessage'
              ? translations.deleteMessage
              : modal.type === 'deleteChat'
              ? translations.deleteChat
              : modal.type === 'copy'
              ? translations.success
              : translations.error
          }
          message={modal.message}
          onConfirm={modal.onConfirm || (() => setModal(null))}
          onCancel={() => setModal(null)}
          confirmText={
            modal.type === 'copy' || modal.type === 'error'
              ? 'OK'
              : translations.confirm
          }
          isError={modal.type === 'error'}
        />
      )}
    </div>
  );
};

export default ChatComponent;
