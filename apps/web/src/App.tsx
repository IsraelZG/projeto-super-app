import { Provider, useTable } from 'tinybase/ui-react';
import { useSyncWorker } from './hooks/useSyncWorker';
import { Timeline } from './core/engines/timeline/timeline';
import { SuperCard } from './core/engines/super-card/super-card';
import { DatabaseInspector } from './components/DatabaseInspector';
import { StoreInspector } from './components/StoreInspector';
import { useCrypto } from './hooks/useCrypto';
import { ulid } from 'ulid';
import { 
  Loader2, Plus, Wifi, Shield, Key, Lock, Copy, Check, Download, 
  AlertTriangle, Eye, EyeOff, KeyRound, Cloud, ArrowRight, RefreshCw, LogOut, Info
} from 'lucide-react';
import { useEffect, useState } from 'react';

// Auxiliar para gerar hash SHA-256 da chave pública
async function hashPublicKey(publicKeyBase64: string): Promise<string> {
  const bytes = Uint8Array.from(atob(publicKeyBase64), c => c.charCodeAt(0));
  const hashBuffer = await crypto.subtle.digest('SHA-256', bytes);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

interface LocalIdentity {
  peerName: string;
  publicKey: string;
  privateKey: string;
  mnemonic: string;
  identityHash: string;
  isEncrypted: boolean;
  encryptedPayload?: any;
}

export function App() {
  const cryptoApi = useCrypto();
  const [screen, setScreen] = useState<string>('loading');
  const [localIdentity, setLocalIdentity] = useState<LocalIdentity | null>(null);
  
  // Form/Input States
  const [peerNameInput, setPeerNameInput] = useState('');
  const [mnemonicText, setMnemonicText] = useState('');
  const [masterPassword, setMasterPassword] = useState('');
  const [localPassword, setLocalPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [useLocalLock, setUseLocalLock] = useState(false);
  const [unlockPassword, setUnlockPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [copiedWordIndex, setCopiedWordIndex] = useState<number | null>(null);
  const [isCopiedAll, setIsCopiedAll] = useState(false);
  
  // Shamir Backup States
  const [totalShards, setTotalShards] = useState(5);
  const [threshold, setThreshold] = useState(3);
  const [generatedShards, setGeneratedShards] = useState<Array<{ id: number; data: string }>>([]);
  
  // Restore States
  const [restoreMnemonicInput, setRestoreMnemonicInput] = useState('');
  const [restoreShardsThreshold, setRestoreShardsThreshold] = useState(3);
  const [restoreShards, setRestoreShards] = useState<Array<{ id: number; data: string }>>([]);
  const [restoreIdentityHash, setRestoreIdentityHash] = useState('');
  const [restorePassword, setRestorePassword] = useState('');
  const [restoreProgressMsg, setRestoreProgressMsg] = useState('');
  const [isRestoring, setIsRestoring] = useState(false);
  const [isCloudBackupPending, setIsCloudBackupPending] = useState(false);
  const [isCloudRestorePending, setIsCloudRestorePending] = useState(false);
  
  // Active Sync States
  const [activePeerName, setActivePeerName] = useState<string | null>(null);
  const { isReady, store, workerApi, webrtc } = useSyncWorker(activePeerName);

  // Carregar identidade local na inicialização
  useEffect(() => {
    const saved = localStorage.getItem('superapp_identity');
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as LocalIdentity;
        setLocalIdentity(parsed);
        if (parsed.isEncrypted) {
          setScreen('local_unlock');
        } else {
          setActivePeerName(parsed.peerName);
          setScreen('main');
        }
      } catch (e) {
        console.error("Erro ao ler identidade local:", e);
        setScreen('welcome');
      }
    } else {
      setScreen('welcome');
    }
  }, []);

  // Sincronizar chaves com o Worker quando estiver pronto
  useEffect(() => {
    if (isReady && workerApi && localIdentity && !localIdentity.isEncrypted) {
      (async () => {
        await workerApi.setSessionKeys(localIdentity.privateKey, 1);
        await workerApi.joinAuthRoom(localIdentity.identityHash);
        (window as any).workerApi = workerApi;
      })();
    }
  }, [isReady, workerApi, localIdentity]);

  // Efeito para processar backup em nuvem pendente
  useEffect(() => {
    if (!isReady || !workerApi || !isCloudBackupPending || !cryptoApi) return;
    
    (async () => {
      try {
        setRestoreProgressMsg('Registrando nó de autenticação seguro...');
        
        const keys = await cryptoApi.deriveKeyPair(mnemonicText);
        const hashId = await hashPublicKey(keys.publicKey);
        const encryptedMnemonicObj = await cryptoApi.encryptSecret(mnemonicText, masterPassword);
        
        // Configurar chaves no worker
        await workerApi.setSessionKeys(keys.privateKey, 1);
        await workerApi.joinAuthRoom(hashId);

        // Injetar nó PROFILE:AUTHENTICATION
        const authNodeData = {
          id: ulid(),
          entity_id: hashId,
          type: 'PROFILE:AUTHENTICATION',
          epoch: 1,
          created_at: Date.now(),
          payload: JSON.stringify(encryptedMnemonicObj),
          retention_state: 'integral'
        };

        await workerApi.injectAndBroadcastNode(authNodeData);
        
        setRestoreProgressMsg('Sincronização concluída com sucesso!');
        setIsCloudBackupPending(false);
        setIsRestoring(false);
        
        // Salvar credenciais locais
        await saveIdentityAndStart(mnemonicText, keys.privateKey, keys.publicKey, hashId);
      } catch (err: any) {
        setIsCloudBackupPending(false);
        setIsRestoring(false);
        setErrorMessage(err.message || 'Falha ao sincronizar custódia.');
      }
    })();
  }, [isReady, workerApi, isCloudBackupPending, cryptoApi, mnemonicText, masterPassword]);

  // Efeito para processar restore em nuvem pendente
  useEffect(() => {
    if (!isReady || !workerApi || !isCloudRestorePending || !cryptoApi) return;

    (async () => {
      try {
        setRestoreProgressMsg('Iniciando handshake e baixando sala auth-room...');
        
        // Entrar na sala restrita
        await workerApi.joinAuthRoom(restoreIdentityHash.trim());

        setRestoreProgressMsg('Aguardando sincronização de custódia (Zero-Knowledge)...');
        
        // Polling local para ver se o nó de autenticação privado chega via P2P
        let nodeRow: any = null;
        let pollCount = 0;
        while (pollCount < 20) {
          const rows = await workerApi.query(
            "SELECT payload FROM nodes WHERE type = 'PROFILE:AUTHENTICATION' LIMIT 1"
          );
          if (rows.length > 0) {
            nodeRow = rows[0];
            break;
          }
          await new Promise(r => setTimeout(r, 1000));
          pollCount++;
        }

        if (!nodeRow) {
          throw new Error("O servidor ou par de custódia não respondeu. Certifique-se de que o ID está correto e que o servidor está conectado.");
        }

        setRestoreProgressMsg('Chave criptografada encontrada! Descriptografando...');

        // Descriptografar payload
        const encryptedSecretObj = JSON.parse(nodeRow[0]);
        const decryptedMnemonic = await cryptoApi.decryptSecret(encryptedSecretObj, restorePassword);
        
        setRestoreProgressMsg('Chave mestra verificada! Inicializando ambiente...');

        // Configurar chaves e salvar
        const keys = await cryptoApi.deriveKeyPair(decryptedMnemonic);
        
        setIsCloudRestorePending(false);
        setIsRestoring(false);
        
        await saveIdentityAndStart(decryptedMnemonic, keys.privateKey, keys.publicKey, restoreIdentityHash.trim());
      } catch (err: any) {
        setIsCloudRestorePending(false);
        setIsRestoring(false);
        setActivePeerName(null);
        setErrorMessage(err.message || 'Erro na recuperação em nuvem. Verifique a senha.');
      }
    })();
  }, [isReady, workerApi, isCloudRestorePending, cryptoApi, restoreIdentityHash, restorePassword]);

  // Copiar mnemônico individualmente
  const handleCopyWord = (word: string, index: number) => {
    navigator.clipboard.writeText(word);
    setCopiedWordIndex(index);
    setTimeout(() => setCopiedWordIndex(null), 1000);
  };

  // Copiar frase completa
  const handleCopyAllMnemonic = () => {
    navigator.clipboard.writeText(mnemonicText);
    setIsCopiedAll(true);
    setTimeout(() => setIsCopiedAll(false), 2000);
  };

  // Descarregar backup de frase
  const handleDownloadBackupText = (text: string, filename = "superapp-backup.txt") => {
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Desbloquear dispositivo
  const handleLocalUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cryptoApi || !localIdentity || !localIdentity.encryptedPayload) return;
    setErrorMessage('');
    try {
      const decryptedJsonStr = await cryptoApi.decryptSecret(localIdentity.encryptedPayload, unlockPassword);
      const creds = JSON.parse(decryptedJsonStr);
      
      // Atualizar estado de login temporário (descriptografado em memória)
      setLocalIdentity({
        ...localIdentity,
        privateKey: creds.privateKey,
        publicKey: creds.publicKey,
        mnemonic: creds.mnemonic,
        isEncrypted: false
      });
      setActivePeerName(localIdentity.peerName);
      setScreen('main');
    } catch (err) {
      setErrorMessage('Senha incorreta. Tente novamente.');
    }
  };

  // Gerar nova identidade mnemônica
  const handleGenerateIdentity = async () => {
    if (!cryptoApi || !peerNameInput.trim()) return;
    setErrorMessage('');
    try {
      const phrase = await cryptoApi.generateMnemonic(128);
      setMnemonicText(phrase);
      setScreen('show_mnemonic');
    } catch (err: any) {
      setErrorMessage(err.message || 'Falha ao gerar identidade');
    }
  };

  // Concluir e salvar nova identidade localmente
  const saveIdentityAndStart = async (rawMnemonic: string, privKey: string, pubKey: string, hashId: string) => {
    if (!cryptoApi) return;
    
    const credsObj = {
      privateKey: privKey,
      publicKey: pubKey,
      mnemonic: rawMnemonic
    };

    let identityToSave: LocalIdentity = {
      peerName: peerNameInput.trim(),
      publicKey: pubKey,
      privateKey: privKey,
      mnemonic: rawMnemonic,
      identityHash: hashId,
      isEncrypted: false
    };

    if (useLocalLock) {
      if (localPassword !== confirmPassword) {
        setErrorMessage('As senhas locais não conferem.');
        return;
      }
      if (localPassword.length < 6) {
        setErrorMessage('A senha de acesso deve ter pelo menos 6 caracteres.');
        return;
      }
      const encrypted = await cryptoApi.encryptSecret(JSON.stringify(credsObj), localPassword);
      identityToSave = {
        peerName: peerNameInput.trim(),
        publicKey: pubKey,
        privateKey: '', // vazia para segurança
        mnemonic: '',   // vazia para segurança
        identityHash: hashId,
        isEncrypted: true,
        encryptedPayload: encrypted
      };
    }

    localStorage.setItem('superapp_identity', JSON.stringify(identityToSave));
    setLocalIdentity(identityToSave);
    
    // Se não estiver criptografado localmente, ativa imediatamente
    if (!identityToSave.isEncrypted) {
      setLocalIdentity({
        ...identityToSave,
        privateKey: privKey,
        publicKey: pubKey,
        mnemonic: rawMnemonic
      });
      setActivePeerName(peerNameInput.trim());
      setScreen('main');
    } else {
      // Caso contrário, pede desbloqueio
      setScreen('local_unlock');
    }
  };

  // Preparar backup autônomo (conclui o onboarding direto)
  const handleSetupAutonomousBackup = async () => {
    if (!cryptoApi) return;
    setErrorMessage('');
    try {
      const keys = await cryptoApi.deriveKeyPair(mnemonicText);
      const hashId = await hashPublicKey(keys.publicKey);
      await saveIdentityAndStart(mnemonicText, keys.privateKey, keys.publicKey, hashId);
    } catch (err: any) {
      setErrorMessage(err.message || 'Falha ao salvar chaves.');
    }
  };

  // Gerar Shamir Shards
  const handleGenerateShamirBackup = async () => {
    if (!cryptoApi) return;
    if (threshold > totalShards) {
      setErrorMessage('O quórum (K) não pode ser maior que o total de pedaços (N).');
      return;
    }
    setErrorMessage('');
    try {
      const shardsList = await cryptoApi.splitSecret(mnemonicText, threshold, totalShards);
      setGeneratedShards(shardsList);
    } catch (err: any) {
      setErrorMessage(err.message || 'Falha ao gerar Shamir');
    }
  };

  // Salvar identidade pós-Shamir
  const handleConfirmShamirBackup = async () => {
    if (!cryptoApi) return;
    try {
      const keys = await cryptoApi.deriveKeyPair(mnemonicText);
      const hashId = await hashPublicKey(keys.publicKey);
      await saveIdentityAndStart(mnemonicText, keys.privateKey, keys.publicKey, hashId);
    } catch (err: any) {
      setErrorMessage(err.message || 'Erro ao finalizar backup Shamir.');
    }
  };

  // Custódia em Servidor Cloud (Zero-Knowledge)
  const handleSetupCloudBackup = async () => {
    if (!cryptoApi || !masterPassword.trim()) return;
    if (masterPassword.length < 8) {
      setErrorMessage('A senha mestra deve conter ao menos 8 caracteres.');
      return;
    }
    setErrorMessage('');
    setIsRestoring(true);
    setRestoreProgressMsg('Inicializando worker de sincronização...');
    
    // Dispara a inicialização do Worker pelo React e marca como pendente
    setActivePeerName(peerNameInput.trim());
    setIsCloudBackupPending(true);
  };

  // Restaurar por Mnemônico direto
  const handleRestoreFromMnemonic = async () => {
    if (!cryptoApi || !restoreMnemonicInput.trim() || !peerNameInput.trim()) {
      setErrorMessage('Preencha o nome do dispositivo e a frase de recuperação.');
      return;
    }
    setErrorMessage('');
    try {
      const valid = await cryptoApi.validateMnemonic(restoreMnemonicInput.trim());
      if (!valid) {
        setErrorMessage('Frase mnemônica inválida ou fora do padrão BIP39.');
        return;
      }
      const keys = await cryptoApi.deriveKeyPair(restoreMnemonicInput.trim());
      const hashId = await hashPublicKey(keys.publicKey);
      
      await saveIdentityAndStart(restoreMnemonicInput.trim(), keys.privateKey, keys.publicKey, hashId);
    } catch (err: any) {
      setErrorMessage(err.message || 'Erro ao restaurar mnemônico');
    }
  };

  // Inicializar inputs para Shamir na Restauração
  const handleSetupRestoreShamirInputs = () => {
    const list = [];
    for (let i = 0; i < restoreShardsThreshold; i++) {
      list.push({ id: i + 1, data: '' });
    }
    setRestoreShards(list);
    setScreen('restore_shamir_inputs');
  };

  // Combinar Shamir Shards
  const handleCombineShamirShards = async () => {
    if (!cryptoApi || !peerNameInput.trim()) return;
    // Validar se todos estão preenchidos
    const filled = restoreShards.filter(s => s.data.trim().length > 0);
    if (filled.length < restoreShardsThreshold) {
      setErrorMessage(`Preencha todos os ${restoreShardsThreshold} pedaços.`);
      return;
    }
    setErrorMessage('');
    try {
      const reconstructedMnemonic = await cryptoApi.combineSecrets(
        filled.map(s => ({ id: s.id, data: s.data.trim() }))
      );
      
      const valid = await cryptoApi.validateMnemonic(reconstructedMnemonic);
      if (!valid) {
        setErrorMessage('A frase combinada gerou um mnemônico inválido. Verifique os segredos.');
        return;
      }
      
      const keys = await cryptoApi.deriveKeyPair(reconstructedMnemonic);
      const hashId = await hashPublicKey(keys.publicKey);
      await saveIdentityAndStart(reconstructedMnemonic, keys.privateKey, keys.publicKey, hashId);
    } catch (err: any) {
      setErrorMessage('Falha na recombinação: pedaços incorretos ou em ordem errada.');
    }
  };

  // Recuperação ZK via Servidor Cloud
  const handleRestoreFromCloud = async () => {
    if (!cryptoApi || !restoreIdentityHash.trim() || !restorePassword.trim() || !peerNameInput.trim()) {
      setErrorMessage('Preencha todos os campos do formulário.');
      return;
    }
    setErrorMessage('');
    setIsRestoring(true);
    setRestoreProgressMsg('Inicializando worker de sincronização...');

    // Dispara a inicialização do Worker pelo React e marca como pendente
    setActivePeerName(peerNameInput.trim());
    setIsCloudRestorePending(true);
  };

  const handleLogout = () => {
    if (confirm("Deseja mesmo deslogar e limpar seus dados locais deste dispositivo?")) {
      localStorage.removeItem('superapp_identity');
      setLocalIdentity(null);
      setActivePeerName(null);
      setScreen('welcome');
    }
  };

  // Renderizador de Telas de Onboarding / Autenticação
  if (screen !== 'main') {
    return (
      <div className="min-h-screen w-screen flex flex-col items-center justify-center bg-[#0d0f14] text-[#e2e8f0] p-6 selection:bg-[#3b82f6]/30 font-sans">
        <div className="w-full max-w-lg bg-[#151922]/80 backdrop-blur-xl border border-[#232a3b] p-8 rounded-2xl shadow-2xl space-y-6 relative overflow-hidden transition-all duration-300">
          {/* Decoração superior */}
          <div className="absolute top-0 left-0 w-full h-[3px] bg-gradient-to-r from-blue-500 via-indigo-500 to-purple-600"></div>
          
          {/* Logo / Header */}
          <div className="flex flex-col items-center text-center space-y-2">
            <div className="w-12 h-12 bg-blue-500/10 rounded-xl flex items-center justify-center border border-blue-500/20 text-blue-400">
              <Shield className="w-6 h-6 animate-pulse" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight bg-gradient-to-r from-white via-[#cbd5e1] to-[#94a3b8] bg-clip-text text-transparent">
              Superapp V3
            </h1>
            <p className="text-xs font-semibold text-blue-400 tracking-wider uppercase">Plataforma Criptográfica Segura</p>
          </div>

          {/* MENSAGEM DE ERRO */}
          {errorMessage && (
            <div className="flex items-start gap-3 bg-red-950/40 border border-red-500/30 text-red-300 p-4 rounded-xl text-xs animate-shake">
              <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">Ocorreu um erro</p>
                <p className="opacity-90">{errorMessage}</p>
              </div>
            </div>
          )}

          {/* 1. TELA BOAS-VINDAS */}
          {screen === 'welcome' && (
            <div className="space-y-4">
              <div className="text-center py-2">
                <p className="text-sm text-slate-400">
                  Bem-vindo à nova arquitetura P2P-First de custódia compartilhada e privacidade absoluta por design.
                </p>
              </div>
              <div className="grid grid-cols-1 gap-3 pt-2">
                <button
                  onClick={() => setScreen('create_peer_name')}
                  className="group flex items-center justify-between p-4 bg-blue-600/10 border border-blue-500/20 rounded-xl hover:bg-blue-600/20 active:scale-[0.99] transition-all text-left"
                >
                  <div className="flex items-center gap-3">
                    <Key className="w-5 h-5 text-blue-400" />
                    <div>
                      <h3 className="text-sm font-semibold text-white">Criar Nova Identidade</h3>
                      <p className="text-xs text-slate-400">Gerar mnemônico BIP39 e chaves locais</p>
                    </div>
                  </div>
                  <ArrowRight className="w-4 h-4 text-slate-400 group-hover:translate-x-1 transition-transform" />
                </button>

                <button
                  onClick={() => setScreen('restore_options')}
                  className="group flex items-center justify-between p-4 bg-slate-800/25 border border-slate-700/30 rounded-xl hover:bg-slate-800/40 active:scale-[0.99] transition-all text-left"
                >
                  <div className="flex items-center gap-3">
                    <RefreshCw className="w-5 h-5 text-slate-400" />
                    <div>
                      <h3 className="text-sm font-semibold text-white">Restaurar Minhas Chaves</h3>
                      <p className="text-xs text-slate-400">Usar frase, Shamir ou nuvem custodiada</p>
                    </div>
                  </div>
                  <ArrowRight className="w-4 h-4 text-slate-400 group-hover:translate-x-1 transition-transform" />
                </button>
              </div>
            </div>
          )}

          {/* 2. DIGITAR DISPOSITIVO */}
          {screen === 'create_peer_name' && (
            <div className="space-y-4">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Nome deste Dispositivo</label>
                <input
                  type="text"
                  placeholder="Ex: Desktop Casa, iPhone..."
                  value={peerNameInput}
                  onChange={e => setPeerNameInput(e.target.value)}
                  className="w-full bg-[#1b202e] border border-[#2c364b] rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-blue-500 text-white"
                />
              </div>
              
              <div className="flex items-center gap-3 bg-blue-950/20 border border-blue-800/20 p-3 rounded-xl">
                <Info className="w-4 h-4 text-blue-400 shrink-0" />
                <p className="text-xs text-slate-400 leading-normal">
                  Identidades P2P derivam chaves determinísticas com base no seu nome de nó e na frase mestra.
                </p>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  onClick={() => setScreen('welcome')}
                  className="flex-1 bg-slate-800/50 border border-slate-700/40 hover:bg-slate-800 text-sm py-2.5 rounded-xl transition-all"
                >
                  Voltar
                </button>
                <button
                  onClick={handleGenerateIdentity}
                  disabled={!peerNameInput.trim()}
                  className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-sm py-2.5 rounded-xl font-medium transition-all"
                >
                  Criar Identidade
                </button>
              </div>
            </div>
          )}

          {/* 3. TELA EXIBIR FRASE */}
          {screen === 'show_mnemonic' && (
            <div className="space-y-4">
              <div className="text-center space-y-1">
                <h3 className="text-base font-semibold text-white">Sua Frase de Recuperação</h3>
                <p className="text-xs text-slate-400">Copie as palavras abaixo na ordem correta. Guarde-as com segurança absoluta.</p>
              </div>

              {/* Grid 3x4 das Palavras */}
              <div className="grid grid-cols-3 gap-2 bg-[#10131a] p-4 rounded-xl border border-[#222938]">
                {mnemonicText.split(' ').map((word, idx) => (
                  <button
                    key={idx}
                    onClick={() => handleCopyWord(word, idx)}
                    className="relative flex items-center justify-between px-3 py-2 bg-[#181d28] hover:bg-[#1f2534] border border-[#263146] rounded-lg text-xs transition-colors group text-left"
                  >
                    <span className="text-[#64748b] font-mono mr-1 select-none">{idx + 1}.</span>
                    <span className="font-semibold font-mono text-white flex-1">{word}</span>
                    <span className="text-[10px] text-blue-400 absolute right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      {copiedWordIndex === idx ? 'Ok!' : 'Copiar'}
                    </span>
                  </button>
                ))}
              </div>

              <div className="flex flex-col sm:flex-row gap-2">
                <button
                  onClick={handleCopyAllMnemonic}
                  className="flex-1 flex items-center justify-center gap-2 bg-slate-800/40 hover:bg-slate-800 border border-slate-700/40 text-xs py-2 rounded-xl transition-all"
                >
                  {isCopiedAll ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5 text-slate-300" />}
                  {isCopiedAll ? 'Copiada com sucesso!' : 'Copiar Frase Inteira'}
                </button>
                <button
                  onClick={() => handleDownloadBackupText(mnemonicText, `${peerNameInput}-backup-mnemonic.txt`)}
                  className="flex items-center justify-center gap-2 bg-slate-800/40 hover:bg-slate-800 border border-slate-700/40 text-xs py-2 px-3 rounded-xl transition-all"
                >
                  <Download className="w-3.5 h-3.5 text-slate-300" />
                  Salvar TXT
                </button>
              </div>

              {/* Toggle Bloqueio Local do App */}
              <div className="border-t border-slate-800 pt-4 space-y-3">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={useLocalLock}
                    onChange={(e) => setUseLocalLock(e.target.checked)}
                    className="w-4 h-4 accent-blue-500 rounded border-slate-700 bg-slate-800"
                  />
                  <div>
                    <span className="text-xs font-semibold text-white">Bloqueio local do dispositivo</span>
                    <p className="text-[10px] text-slate-400">Exige senha toda vez que abrir o aplicativo</p>
                  </div>
                </label>

                {useLocalLock && (
                  <div className="grid grid-cols-2 gap-2 animate-fadeIn">
                    <input
                      type="password"
                      placeholder="Senha do App"
                      value={localPassword}
                      onChange={e => setLocalPassword(e.target.value)}
                      className="bg-[#1b202e] border border-[#2c364b] rounded-lg px-3 py-1.5 text-xs text-white"
                    />
                    <input
                      type="password"
                      placeholder="Confirmar Senha"
                      value={confirmPassword}
                      onChange={e => setConfirmPassword(e.target.value)}
                      className="bg-[#1b202e] border border-[#2c364b] rounded-lg px-3 py-1.5 text-xs text-white"
                    />
                  </div>
                )}
              </div>

              {/* Botão de Avanço */}
              <button
                onClick={() => setScreen('backup_options')}
                className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 text-sm py-3 rounded-xl font-medium transition-all"
              >
                Configurar Backup de Segurança
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* 4. TELA OPÇÕES DE BACKUP */}
          {screen === 'backup_options' && (
            <div className="space-y-4">
              <div className="text-center">
                <h3 className="text-base font-semibold text-white">Como quer proteger suas chaves?</h3>
                <p className="text-xs text-slate-400 mt-1">Selecione o modelo de custódia e redundância desejado.</p>
              </div>

              <div className="grid grid-cols-1 gap-3">
                <button
                  onClick={handleSetupAutonomousBackup}
                  className="flex items-start gap-4 p-4 bg-slate-800/25 border border-slate-700/30 rounded-xl hover:bg-slate-800/40 text-left transition-all"
                >
                  <Shield className="w-5 h-5 text-green-400 mt-0.5 shrink-0" />
                  <div>
                    <h4 className="text-sm font-semibold text-white">Autônomo (Sem Backup Externo)</h4>
                    <p className="text-xs text-slate-400 mt-0.5">Nenhum dado sai do seu aparelho. A responsabilidade da frase é 100% sua.</p>
                  </div>
                </button>

                <button
                  onClick={() => setScreen('backup_shamir')}
                  className="flex items-start gap-4 p-4 bg-slate-800/25 border border-slate-700/30 rounded-xl hover:bg-slate-800/40 text-left transition-all"
                >
                  <KeyRound className="w-5 h-5 text-amber-400 mt-0.5 shrink-0" />
                  <div>
                    <h4 className="text-sm font-semibold text-white">Shamir's Secret Sharing (K-de-N)</h4>
                    <p className="text-xs text-slate-400 mt-0.5">Divide a frase em $N$ pedaços. Você precisa de $K$ pedaços para restaurar. Perfeito para custódia social.</p>
                  </div>
                </button>

                <button
                  onClick={() => setScreen('backup_cloud')}
                  className="flex items-start gap-4 p-4 bg-slate-800/25 border border-slate-700/30 rounded-xl hover:bg-slate-800/40 text-left transition-all"
                >
                  <Cloud className="w-5 h-5 text-blue-400 mt-0.5 shrink-0" />
                  <div>
                    <h4 className="text-sm font-semibold text-white">Custódia Zero-Knowledge (Nuvem)</h4>
                    <p className="text-xs text-slate-400 mt-0.5">Sua frase é cifrada com senha mestra e enviada criptografada ao Peer Cloud de forma isolada.</p>
                  </div>
                </button>
              </div>

              <button
                onClick={() => setScreen('show_mnemonic')}
                className="w-full bg-slate-800/50 hover:bg-slate-800 text-xs py-2 rounded-xl transition-all"
              >
                Voltar para Frase
              </button>
            </div>
          )}

          {/* 5. TELA SHAMIR BACKUP */}
          {screen === 'backup_shamir' && (
            <div className="space-y-4">
              <div className="text-center space-y-1">
                <h3 className="text-base font-semibold text-white">Dividir com Shamir (K-de-N)</h3>
                <p className="text-xs text-slate-400">Configure a redundância da sua chave de segurança.</p>
              </div>

              <div className="space-y-3 bg-[#11141c] p-4 rounded-xl border border-slate-800">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-400">Total de Pedaços (N):</span>
                  <span className="font-semibold text-white">{totalShards} pedaços</span>
                </div>
                <input 
                  type="range" min="3" max="10" 
                  value={totalShards} 
                  onChange={e => setTotalShards(parseInt(e.target.value))}
                  className="w-full"
                />

                <div className="flex justify-between text-xs">
                  <span className="text-slate-400">Limiar de Recuperação (K):</span>
                  <span className="font-semibold text-white">{threshold} pedaços necessários</span>
                </div>
                <input 
                  type="range" min="2" max={totalShards} 
                  value={threshold} 
                  onChange={e => setThreshold(parseInt(e.target.value))}
                  className="w-full"
                />
                
                <div className="text-[10px] text-slate-500 leading-normal">
                  Serão gerados {totalShards} pedaços distintos. Para recuperar o seu mnemônico original no futuro, você precisará colar quaisquer {threshold} pedaços gerados.
                </div>
              </div>

              {generatedShards.length === 0 ? (
                <button
                  onClick={handleGenerateShamirBackup}
                  className="w-full bg-[#1e293b] hover:bg-slate-800 border border-slate-700/60 text-sm py-2.5 rounded-xl transition-all font-semibold"
                >
                  Gerar Pedacos do Segredo
                </button>
              ) : (
                <div className="space-y-3">
                  <h4 className="text-xs font-semibold text-slate-400">Pedaços Gerados:</h4>
                  <div className="max-h-48 overflow-y-auto space-y-2 pr-1">
                    {generatedShards.map(shard => (
                      <div key={shard.id} className="flex items-center justify-between p-3 bg-[#1c2230] border border-slate-800 rounded-lg text-xs">
                        <span className="font-mono text-slate-400">Pedaço #{shard.id}</span>
                        <div className="flex gap-2">
                          <button
                            onClick={() => navigator.clipboard.writeText(shard.data)}
                            className="text-blue-400 hover:text-blue-300 font-semibold"
                          >
                            Copiar
                          </button>
                          <button
                            onClick={() => handleDownloadBackupText(shard.data, `${peerNameInput}-shard-${shard.id}.txt`)}
                            className="text-slate-400 hover:text-white"
                          >
                            Baixar
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  <button
                    onClick={handleConfirmShamirBackup}
                    className="w-full bg-blue-600 hover:bg-blue-500 text-sm py-3 rounded-xl font-medium transition-all"
                  >
                    Concluir e Salvar
                  </button>
                </div>
              )}

              <button
                onClick={() => { setGeneratedShards([]); setScreen('backup_options'); }}
                className="w-full bg-slate-800/50 hover:bg-slate-800 text-xs py-2 rounded-xl transition-all"
              >
                Voltar
              </button>
            </div>
          )}

          {/* 6. TELA BACKUP CLOUD */}
          {screen === 'backup_cloud' && (
            <div className="space-y-4">
              <div className="text-center space-y-1">
                <h3 className="text-base font-semibold text-white">Custódia Zero-Knowledge</h3>
                <p className="text-xs text-slate-400">Sua semente será criptografada no seu dispositivo com a senha fornecida abaixo.</p>
              </div>

              {isRestoring ? (
                <div className="flex flex-col items-center justify-center py-8 space-y-3">
                  <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
                  <p className="text-xs text-slate-400">{restoreProgressMsg}</p>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Crie uma Senha Mestra de Recuperação</label>
                    <input
                      type="password"
                      placeholder="Mínimo 8 caracteres"
                      value={masterPassword}
                      onChange={e => setMasterPassword(e.target.value)}
                      className="w-full bg-[#1b202e] border border-[#2c364b] rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-blue-500 text-white"
                    />
                  </div>

                  <div className="flex items-start gap-3 bg-amber-950/20 border border-amber-900/30 p-3.5 rounded-xl text-[11px] text-amber-300/90 leading-normal">
                    <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                    <p>
                      <strong>Atenção:</strong> O servidor guarda seu backup cifrado sem ter acesso às chaves decodificadas. 
                      Se você esquecer esta senha mestra, o backup em nuvem será permanentemente ilegível.
                    </p>
                  </div>

                  <button
                    onClick={handleSetupCloudBackup}
                    disabled={masterPassword.length < 8}
                    className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-sm py-3 rounded-xl font-medium transition-all"
                  >
                    Criptografar e Enviar para Nuvem
                  </button>
                </div>
              )}

              {!isRestoring && (
                <button
                  onClick={() => setScreen('backup_options')}
                  className="w-full bg-slate-800/50 hover:bg-slate-800 text-xs py-2 rounded-xl transition-all"
                >
                  Voltar
                </button>
              )}
            </div>
          )}

          {/* 7. RESTAURAR OPÇÕES */}
          {screen === 'restore_options' && (
            <div className="space-y-4">
              <div className="text-center">
                <h3 className="text-base font-semibold text-white">Escolha o método de restauração</h3>
                <p className="text-xs text-slate-400 mt-1">Como você deseja reconstruir suas chaves?</p>
              </div>

              <div className="grid grid-cols-1 gap-3">
                <button
                  onClick={() => setScreen('restore_mnemonic')}
                  className="flex items-start gap-4 p-4 bg-slate-800/25 border border-slate-700/30 rounded-xl hover:bg-slate-800/40 text-left transition-all"
                >
                  <Key className="w-5 h-5 text-blue-400 mt-0.5 shrink-0" />
                  <div>
                    <h4 className="text-sm font-semibold text-white">Digitar Frase BIP39</h4>
                    <p className="text-xs text-slate-400 mt-0.5">Escreva sua frase mnemônica de 12 ou 24 palavras.</p>
                  </div>
                </button>

                <button
                  onClick={() => setScreen('restore_shamir_config')}
                  className="flex items-start gap-4 p-4 bg-slate-800/25 border border-slate-700/30 rounded-xl hover:bg-slate-800/40 text-left transition-all"
                >
                  <KeyRound className="w-5 h-5 text-amber-400 mt-0.5 shrink-0" />
                  <div>
                    <h4 className="text-sm font-semibold text-white">Recombinar Pedaços Shamir</h4>
                    <p className="text-xs text-slate-400 mt-0.5">Cole a quantidade necessária de shards para restabelecer a frase original.</p>
                  </div>
                </button>

                <button
                  onClick={() => setScreen('restore_cloud')}
                  className="flex items-start gap-4 p-4 bg-slate-800/25 border border-slate-700/30 rounded-xl hover:bg-slate-800/40 text-left transition-all"
                >
                  <Cloud className="w-5 h-5 text-indigo-400 mt-0.5 shrink-0" />
                  <div>
                    <h4 className="text-sm font-semibold text-white">Recuperar via Custódia na Nuvem</h4>
                    <p className="text-xs text-slate-400 mt-0.5">Use o ID da sua identidade e a senha mestra para baixar e descriptografar o backup.</p>
                  </div>
                </button>
              </div>

              <button
                onClick={() => setScreen('welcome')}
                className="w-full bg-slate-800/50 hover:bg-slate-800 text-xs py-2 rounded-xl transition-all"
              >
                Voltar
              </button>
            </div>
          )}

          {/* 8. RESTAURAR VIA FRASE */}
          {screen === 'restore_mnemonic' && (
            <div className="space-y-4">
              <div className="text-center">
                <h3 className="text-base font-semibold text-white">Digite sua Frase de Recuperação</h3>
                <p className="text-xs text-slate-400 mt-1">Coloque as 12 ou 24 palavras separadas por espaço.</p>
              </div>

              <div className="space-y-3">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Nome deste Dispositivo</label>
                  <input
                    type="text"
                    placeholder="Ex: Novo Laptop, Celular..."
                    value={peerNameInput}
                    onChange={e => setPeerNameInput(e.target.value)}
                    className="w-full bg-[#1b202e] border border-[#2c364b] rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-blue-500 text-white"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Frase BIP39</label>
                  <textarea
                    rows={4}
                    placeholder="Escreva suas palavras aqui..."
                    value={restoreMnemonicInput}
                    onChange={e => setRestoreMnemonicInput(e.target.value)}
                    className="w-full bg-[#1b202e] border border-[#2c364b] rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-blue-500 text-white font-mono"
                  />
                </div>

                {/* Toggle Bloqueio Local do App */}
                <div className="border-t border-slate-800 pt-3 space-y-3">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={useLocalLock}
                      onChange={(e) => setUseLocalLock(e.target.checked)}
                      className="w-4 h-4 accent-blue-500 rounded border-slate-700 bg-slate-800"
                    />
                    <div>
                      <span className="text-xs font-semibold text-white">Bloqueio local do dispositivo</span>
                      <p className="text-[10px] text-slate-400">Exige senha toda vez que abrir o aplicativo</p>
                    </div>
                  </label>

                  {useLocalLock && (
                    <div className="grid grid-cols-2 gap-2 animate-fadeIn">
                      <input
                        type="password"
                        placeholder="Senha do App"
                        value={localPassword}
                        onChange={e => setLocalPassword(e.target.value)}
                        className="bg-[#1b202e] border border-[#2c364b] rounded-lg px-3 py-1.5 text-xs text-white"
                      />
                      <input
                        type="password"
                        placeholder="Confirmar Senha"
                        value={confirmPassword}
                        onChange={e => setConfirmPassword(e.target.value)}
                        className="bg-[#1b202e] border border-[#2c364b] rounded-lg px-3 py-1.5 text-xs text-white"
                      />
                    </div>
                  )}
                </div>

                <button
                  onClick={handleRestoreFromMnemonic}
                  disabled={!restoreMnemonicInput.trim() || !peerNameInput.trim()}
                  className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-sm py-2.5 rounded-xl font-medium transition-all"
                >
                  Restaurar e Conectar
                </button>
              </div>

              <button
                onClick={() => setScreen('restore_options')}
                className="w-full bg-slate-800/50 hover:bg-slate-800 text-xs py-2 rounded-xl transition-all"
              >
                Voltar
              </button>
            </div>
          )}

          {/* 9. RESTAURAR SHAMIR CONFIG */}
          {screen === 'restore_shamir_config' && (
            <div className="space-y-4">
              <div className="text-center">
                <h3 className="text-base font-semibold text-white">Recuperação via Shamir</h3>
                <p className="text-xs text-slate-400 mt-1">Quantos pedaços (limiar K) você tem para recombinar?</p>
              </div>

              <div className="space-y-4">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Nome deste Dispositivo</label>
                  <input
                    type="text"
                    placeholder="Ex: Celular 2..."
                    value={peerNameInput}
                    onChange={e => setPeerNameInput(e.target.value)}
                    className="w-full bg-[#1b202e] border border-[#2c364b] rounded-xl px-4 py-2.5 text-sm text-white"
                  />
                </div>

                <div className="space-y-2 bg-[#11141c] p-4 rounded-xl border border-slate-800">
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-slate-400">Pedaços que irei fornecer (K):</span>
                    <span className="font-semibold text-white">{restoreShardsThreshold} pedaços</span>
                  </div>
                  <input 
                    type="range" min="2" max="10" 
                    value={restoreShardsThreshold} 
                    onChange={e => setRestoreShardsThreshold(parseInt(e.target.value))}
                    className="w-full"
                  />
                </div>

                <button
                  onClick={handleSetupRestoreShamirInputs}
                  disabled={!peerNameInput.trim()}
                  className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-sm py-2.5 rounded-xl font-medium transition-all"
                >
                  Continuar
                </button>
              </div>

              <button
                onClick={() => setScreen('restore_options')}
                className="w-full bg-slate-800/50 hover:bg-slate-800 text-xs py-2 rounded-xl transition-all"
              >
                Voltar
              </button>
            </div>
          )}

          {/* 10. INSERIR SHAMIR SHARDS */}
          {screen === 'restore_shamir_inputs' && (
            <div className="space-y-4">
              <div className="text-center">
                <h3 className="text-base font-semibold text-white">Insira os pedaços</h3>
                <p className="text-xs text-slate-400 mt-1">Cole exatamente {restoreShardsThreshold} chaves de pedaço geradas anteriormente.</p>
              </div>

              <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
                {restoreShards.map((shard, idx) => (
                  <div key={shard.id} className="space-y-1">
                    <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">ID Pedaço #{shard.id}</label>
                    <div className="flex gap-2">
                      <input
                        type="number"
                        placeholder="ID"
                        min="1"
                        value={shard.id}
                        onChange={e => {
                          const newShards = [...restoreShards];
                          newShards[idx].id = parseInt(e.target.value) || 1;
                          setRestoreShards(newShards);
                        }}
                        className="w-16 bg-[#1b202e] border border-[#2c364b] rounded-lg px-2 text-center text-xs text-white"
                      />
                      <input
                        type="text"
                        placeholder="Cole o código do pedaço aqui..."
                        value={shard.data}
                        onChange={e => {
                          const newShards = [...restoreShards];
                          newShards[idx].data = e.target.value;
                          setRestoreShards(newShards);
                        }}
                        className="flex-1 bg-[#1b202e] border border-[#2c364b] rounded-lg px-3 py-2 text-xs text-white font-mono"
                      />
                    </div>
                  </div>
                ))}
              </div>

              {/* Toggle Bloqueio Local do App */}
              <div className="border-t border-slate-800 pt-3 space-y-3">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={useLocalLock}
                    onChange={(e) => setUseLocalLock(e.target.checked)}
                    className="w-4 h-4 accent-blue-500 rounded border-slate-700 bg-slate-800"
                  />
                  <div>
                    <span className="text-xs font-semibold text-white">Bloqueio local do dispositivo</span>
                    <p className="text-[10px] text-slate-400">Exige senha toda vez que abrir o aplicativo</p>
                  </div>
                </label>

                {useLocalLock && (
                  <div className="grid grid-cols-2 gap-2 animate-fadeIn">
                    <input
                      type="password"
                      placeholder="Senha do App"
                      value={localPassword}
                      onChange={e => setLocalPassword(e.target.value)}
                      className="bg-[#1b202e] border border-[#2c364b] rounded-lg px-3 py-1.5 text-xs text-white"
                    />
                    <input
                      type="password"
                      placeholder="Confirmar Senha"
                      value={confirmPassword}
                      onChange={e => setConfirmPassword(e.target.value)}
                      className="bg-[#1b202e] border border-[#2c364b] rounded-lg px-3 py-1.5 text-xs text-white"
                    />
                  </div>
                )}
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => setScreen('restore_shamir_config')}
                  className="flex-1 bg-slate-800/50 hover:bg-slate-800 text-xs py-2.5 rounded-xl transition-all"
                >
                  Voltar
                </button>
                <button
                  onClick={handleCombineShamirShards}
                  className="flex-1 bg-blue-600 hover:bg-blue-500 text-xs py-2.5 rounded-xl font-medium transition-all"
                >
                  Recombinar e Restaurar
                </button>
              </div>
            </div>
          )}

          {/* 11. RESTAURAR VIA CUSTÓDIA CLOUD */}
          {screen === 'restore_cloud' && (
            <div className="space-y-4">
              <div className="text-center">
                <h3 className="text-base font-semibold text-white">Restauração via Custódia Nuvem</h3>
                <p className="text-xs text-slate-400 mt-1">Recupere sua conta de forma protegida em Zero-Knowledge.</p>
              </div>

              {isRestoring ? (
                <div className="flex flex-col items-center justify-center py-8 space-y-3">
                  <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
                  <p className="text-xs text-slate-400 font-mono text-center px-4 leading-normal">{restoreProgressMsg}</p>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Nome deste Dispositivo</label>
                    <input
                      type="text"
                      placeholder="Ex: Novo iPad..."
                      value={peerNameInput}
                      onChange={e => setPeerNameInput(e.target.value)}
                      className="w-full bg-[#1b202e] border border-[#2c364b] rounded-xl px-4 py-2 text-sm text-white"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">ID da Identidade (Hash da Chave Pública)</label>
                    <input
                      type="text"
                      placeholder="Cole o Hash SHA-256 fornecido pelo backup"
                      value={restoreIdentityHash}
                      onChange={e => setRestoreIdentityHash(e.target.value)}
                      className="w-full bg-[#1b202e] border border-[#2c364b] rounded-xl px-4 py-2 text-sm text-white font-mono"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Senha Mestra de Custódia</label>
                    <input
                      type="password"
                      placeholder="A senha criada no Onboarding"
                      value={restorePassword}
                      onChange={e => setRestorePassword(e.target.value)}
                      className="w-full bg-[#1b202e] border border-[#2c364b] rounded-xl px-4 py-2 text-sm text-white"
                    />
                  </div>

                  {/* Toggle Bloqueio Local do App */}
                  <div className="border-t border-slate-800 pt-3 space-y-3">
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={useLocalLock}
                        onChange={(e) => setUseLocalLock(e.target.checked)}
                        className="w-4 h-4 accent-blue-500 rounded border-slate-700 bg-slate-800"
                      />
                      <div>
                        <span className="text-xs font-semibold text-white">Bloqueio local do dispositivo</span>
                        <p className="text-[10px] text-slate-400">Exige senha toda vez que abrir o aplicativo</p>
                      </div>
                    </label>

                    {useLocalLock && (
                      <div className="grid grid-cols-2 gap-2 animate-fadeIn">
                        <input
                          type="password"
                          placeholder="Senha do App"
                          value={localPassword}
                          onChange={e => setLocalPassword(e.target.value)}
                          className="bg-[#1b202e] border border-[#2c364b] rounded-lg px-3 py-1.5 text-xs text-white"
                        />
                        <input
                          type="password"
                          placeholder="Confirmar Senha"
                          value={confirmPassword}
                          onChange={e => setConfirmPassword(e.target.value)}
                          className="bg-[#1b202e] border border-[#2c364b] rounded-lg px-3 py-1.5 text-xs text-white"
                        />
                      </div>
                    )}
                  </div>

                  <button
                    onClick={handleRestoreFromCloud}
                    disabled={!restoreIdentityHash.trim() || !restorePassword.trim() || !peerNameInput.trim()}
                    className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-sm py-2.5 rounded-xl font-medium transition-all"
                  >
                    Baixar e Restaurar
                  </button>
                </div>
              )}

              {!isRestoring && (
                <button
                  onClick={() => setScreen('restore_options')}
                  className="w-full bg-slate-800/50 hover:bg-slate-800 text-xs py-2 rounded-xl transition-all"
                >
                  Voltar
                </button>
              )}
            </div>
          )}

          {/* 12. TELA DESBLOQUEIO LOCAL (LOCK SCREEN) */}
          {screen === 'local_unlock' && (
            <form onSubmit={handleLocalUnlock} className="space-y-4">
              <div className="text-center space-y-1">
                <h3 className="text-base font-semibold text-white">Dispositivo Bloqueado</h3>
                <p className="text-xs text-slate-400">Forneça a senha local do aplicativo para descriptografar seu perfil.</p>
              </div>

              <div className="space-y-2">
                <input
                  autoFocus
                  type="password"
                  placeholder="Senha do dispositivo..."
                  value={unlockPassword}
                  onChange={e => setUnlockPassword(e.target.value)}
                  className="w-full bg-[#1b202e] border border-[#2c364b] rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-blue-500 text-white"
                />

                <button
                  type="submit"
                  disabled={!unlockPassword.trim()}
                  className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-sm py-2.5 rounded-xl font-medium transition-all flex items-center justify-center gap-2"
                >
                  <Lock className="w-4 h-4" />
                  Desbloquear
                </button>
              </div>

              <div className="pt-2 text-center">
                <button
                  type="button"
                  onClick={handleLogout}
                  className="text-xs text-red-400 hover:underline"
                >
                  Deslogar e Limpar Identidade
                </button>
              </div>
            </form>
          )}

        </div>
      </div>
    );
  }

  // 13. ESTADO DE CARREGAMENTO DO SYNC WORKER
  if (!isReady || !store || !workerApi) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-[#0d0f14] text-[#e2e8f0]">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
          <p className="text-sm text-slate-400">Sincronizando banco de dados local (OPFS)...</p>
        </div>
      </div>
    );
  }

  // 14. TELA PRINCIPAL (MAINSCREEN)
  return (
    <Provider store={store}>
      <MainScreen 
        workerApi={workerApi} 
        webrtc={webrtc} 
        localIdentity={localIdentity} 
        onLogout={handleLogout}
      />
    </Provider>
  );
}

function MainScreen({ 
  workerApi, 
  webrtc, 
  localIdentity, 
  onLogout 
}: { 
  workerApi: any; 
  webrtc: any; 
  localIdentity: LocalIdentity | null; 
  onLogout: () => void;
}) {
  const [connectionStatus, setConnectionStatus] = useState<string>('Offline');
  const [connectedPeers, setConnectedPeers] = useState<{peerId: string, peerName: string}[]>([]);

  useEffect(() => {
    if (!webrtc) return;
    const interval = setInterval(() => {
      const status = webrtc.hasConnections() ? 'Conectado (P2P)' : 'Desconectado / Aguardando';
      setConnectionStatus(status);

      const peers = webrtc.getConnectedPeers();
      setConnectedPeers(peers);
    }, 1000);
    return () => clearInterval(interval);
  }, [webrtc]);

  // Hook reativo do TinyBase
  const entityHeads = useTable('entity_heads');
  
  // Mapeamento na Timeline (Newest first)
  const items = Object.entries(entityHeads).reverse().map(([entity_id, data]) => ({
    id: entity_id,
    node_id: data.node_id
  }));

  const handleCreateRandom = async () => {
    const entity_id = ulid();
    const node_id = ulid();
    const createdAt = Date.now();

    // Injeta o nó localmente (Será automaticamente criptografado no Worker antes de ir ao disco e Yjs!)
    await workerApi.injectAndBroadcastNode({
      id: node_id,
      entity_id,
      type: 'CONTENT:POST', // Começa com CONTENT: logo será criptografado via E2EE!
      epoch: 1,
      created_at: createdAt,
      payload: JSON.stringify({
        title: "Publicação Criptografada",
        content: `Esta mensagem foi cifrada localmente com AES-GCM usando chave de época às ${new Date().toLocaleTimeString()}. Apenas quem tem a chave de época atual pode ler.`,
        author: localIdentity?.peerName || 'Dispositivo'
      }),
      retention_state: 'integral'
    });
  };

  const handleResetDatabase = async () => {
    if (confirm("Tem certeza que deseja apagar todos os dados locais?")) {
      await workerApi.compactSnapshot('global-room');
      await workerApi.resetDatabase();
      window.location.reload();
    }
  };

  return (
    <div className="min-h-screen bg-[#0d0f14] text-[#e2e8f0] p-8 selection:bg-blue-600/30">
      <div className="max-w-[1600px] mx-auto space-y-6">
        
        {/* Header Superior */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 bg-[#151922] border border-[#232a3b] p-6 rounded-2xl shadow-xl">
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold tracking-tight">Superapp P2P</h1>
              <span className="px-2.5 py-0.5 bg-blue-500/10 border border-blue-500/20 text-blue-400 rounded-full text-xs font-semibold">
                E2EE Ativo
              </span>
            </div>
            
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-400 pt-1">
              <span className="flex items-center gap-1.5">
                <span className={`w-2.5 h-2.5 rounded-full ${connectionStatus !== 'Offline' ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
                Status: {connectionStatus}
              </span>
              <span>•</span>
              <span className="font-semibold text-white">Dispositivo: {localIdentity?.peerName}</span>
              {localIdentity?.identityHash && (
                <>
                  <span>•</span>
                  <span className="font-mono text-xs">ID: {localIdentity.identityHash.slice(0, 16)}...</span>
                </>
              )}
            </div>

            {connectedPeers.length > 0 && (
              <p className="text-xs text-[#94a3b8] font-mono pt-1">
                Pares Conectados: {connectedPeers.map(p => p.peerName).join(', ')}
              </p>
            )}
          </div>

          {/* Ações */}
          <div className="flex gap-2 w-full md:w-auto">
            <button 
              onClick={onLogout}
              className="flex items-center justify-center gap-2 bg-[#1b202e] hover:bg-[#252c3f] border border-slate-700/60 px-4 py-2.5 rounded-xl transition-all font-medium text-xs text-slate-300"
            >
              <LogOut className="w-3.5 h-3.5" />
              Sair
            </button>
            <button 
              onClick={handleResetDatabase}
              className="flex items-center justify-center gap-2 bg-red-600/10 hover:bg-red-600/20 text-red-400 border border-red-500/20 px-4 py-2.5 rounded-xl transition-all font-medium text-xs"
            >
              Resetar BD
            </button>
            <button 
              onClick={handleCreateRandom}
              className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 active:scale-95 text-white px-5 py-2.5 rounded-xl font-semibold text-xs shadow-lg shadow-blue-500/10 transition-all"
            >
              <Plus className="w-4 h-4" />
              Novo Post Criptografado
            </button>
          </div>
        </div>

        {/* Dashboard Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* Col 1: Timeline */}
          <div className="space-y-4">
            <div className="flex items-center justify-between px-1">
              <h2 className="text-lg font-bold tracking-tight">Publicações (Timeline)</h2>
              <span className="px-2 py-0.5 bg-slate-800 rounded-md text-xs font-mono text-slate-400">{items.length} itens</span>
            </div>
            
            <Timeline 
              items={items} 
              renderItem={(item) => (
                <SuperCard 
                  key={item.id}
                  title={`Post: ${item.id.slice(0, 8)}...`}
                  subtitle={`ID do Nó: ${item.node_id.slice(0, 16)}...`}
                  body="Nó gerado em CONTENT:POST. O payload foi cifrado com a chave de época atual no banco de dados e sincronizado no canal global. Somente pares autorizados com acesso à época decifram no carregamento da UI."
                />
              )} 
            />

            {items.length === 0 && (
              <div className="text-center py-16 border-2 border-dashed border-[#232a3b] rounded-2xl text-slate-500 bg-[#11141c]/50">
                <Lock className="w-8 h-8 text-slate-600 mx-auto mb-2" />
                <p className="text-sm font-semibold">Sem dados na Timeline</p>
                <p className="text-xs text-slate-400 mt-1">Crie um post criptografado para iniciar.</p>
              </div>
            )}
          </div>

          {/* Col 2: Store Inspector (TinyBase) */}
          <div className="space-y-4">
            <StoreInspector 
              workerApi={workerApi} 
              latestEntityId={items.length > 0 ? items[0].id : null} 
            />
          </div>

          {/* Col 3: Database Inspector (SQLite) */}
          <div className="space-y-4">
            <DatabaseInspector workerApi={workerApi} />
          </div>

        </div>
      </div>
    </div>
  );
}

export default App;
