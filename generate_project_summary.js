import fs from 'fs';
import path from 'path';
import ignore from 'ignore'; // Necessário para processar o .gitignore

// --- Configuração ---
const OUTPUT_BASENAME = 'project_structure_and_content';
const OUTPUT_EXTENSION = '.txt';
const CURRENT_DIR = process.cwd();
const SCRIPT_NAME = path.basename(import.meta.url).split('?')[0]; // Adaptação para ES Modules

// --- Variáveis globais para construir a saída ---
let diagramContent = 'Estrutura do Projeto:\n';
let fileContents = '\n--- Conteúdo dos Arquivos ---\n';
let filesToRead = []; // Para armazenar os caminhos dos arquivos que não são ignorados

// --- Configuração das regras de ignorar ---
const ig = ignore();

// Adiciona regras para ignorar o próprio script, o arquivo de saída e a pasta .git
ig.add(OUTPUT_BASENAME + '*'); // Agora ignora todos os arquivos de saída
ig.add(SCRIPT_NAME);
ig.add('.git/');

// Função para gerar o nome do arquivo com versionamento incremental
function getOutputFilename() {
  let counter = 1;
  let filename = `${OUTPUT_BASENAME}${OUTPUT_EXTENSION}`;
  
  while (fs.existsSync(path.join(CURRENT_DIR, filename))) {
    filename = `${OUTPUT_BASENAME}_${counter}${OUTPUT_EXTENSION}`;
    counter++;
  }
  
  return filename;
}

// Função para carregar as regras do .gitignore
function loadGitignore(dir) {
  const gitignorePath = path.join(dir, '.gitignore');
  if (fs.existsSync(gitignorePath)) {
    const gitignoreContent = fs.readFileSync(gitignorePath, 'utf8');
    // Adiciona as regras do .gitignore à instância do 'ignore'
    ig.add(gitignoreContent.split('\n').filter((line) => line.trim() !== ''));
  }
}

// Função recursiva para construir o diagrama de diretórios e coletar arquivos
function buildStructure(currentPath, prefix = '', rootPath = CURRENT_DIR) {
  const items = fs.readdirSync(currentPath, { withFileTypes: true });

  // Filtra os itens ignorados para determinar corretamente o último item para o desenho do diagrama
  const visibleItems = items.filter((dirent) => {
    const itemRelativePath = path.relative(rootPath, path.join(currentPath, dirent.name));
    return !ig.ignores(itemRelativePath);
  });

  for (let i = 0; i < visibleItems.length; i++) {
    const dirent = visibleItems[i];
    const itemName = dirent.name;
    const itemPath = path.join(currentPath, itemName);
    const isLast = i === visibleItems.length - 1;

    const connector = isLast ? '└── ' : '├── ';
    const newPrefix = prefix + (isLast ? '    ' : '│   '); // Ajusta o prefixo para o próximo nível

    if (dirent.isDirectory()) {
      diagramContent += `${prefix}${connector}${itemName}/\n`;
      buildStructure(itemPath, newPrefix, rootPath); // Chamada recursiva para subdiretórios
    } else if (dirent.isFile()) {
      diagramContent += `${prefix}${connector}${itemName}\n`;
      filesToRead.push(itemPath); // Adiciona o arquivo à lista para leitura posterior
    }
  }
}

// Função para ler e anexar o conteúdo dos arquivos à string global fileContents
function appendFileContents() {
  for (const filePath of filesToRead) {
    try {
      const relativePath = path.relative(CURRENT_DIR, filePath);
      // Verifica se o arquivo é um tipo de texto comum para evitar erros com binários
      const ext = path.extname(filePath).toLowerCase();
      const textExtensions = [
        '.js',
        '.jsx',
        '.ts',
        '.tsx',
        '.vue',
        '.html',
        '.css',
        '.scss',
        '.less',
        '.json',
        '.md',
        '.txt',
        '.xml',
        '.yml',
        '.yaml',
        '.svg',
        '.env',
        '.gitignore',
        '.log',
        '.gitattributes',
      ]; // Adicionados .log e .gitattributes como extensões de texto comuns

      if (textExtensions.includes(ext) || !ext) {
        // Lê sem extensão ou com extensão de texto
        const content = fs.readFileSync(filePath, 'utf8');
        fileContents += `\n--- Conteúdo de: ${relativePath} ---\n`;
        fileContents += content;
        fileContents += '\n'; // Adiciona uma nova linha extra para separação
      } else {
        fileContents += `\n--- Conteúdo de: ${relativePath} (Arquivo binário/não-texto ignorado na transcrição) ---\n`;
      }
    } catch (error) {
      // Caso ocorra um erro na leitura do arquivo (ex: permissão negada, arquivo ilegível por outro motivo)
      fileContents += `\n--- Não foi possível ler o conteúdo de: ${path.relative(CURRENT_DIR, filePath)} ---\n`;
      fileContents += `Erro: ${error.message}\n`;
    }
  }
}

// --- Execução principal ---
async function main() {
  console.log('Gerando estrutura e conteúdo do projeto...');
  // Carrega as regras do .gitignore da pasta atual
  loadGitignore(CURRENT_DIR);

  diagramContent += `.\n`; // Representa o diretório raiz

  // Inicia a construção da estrutura a partir do diretório atual
  buildStructure(CURRENT_DIR, '', CURRENT_DIR);

  // Agora anexa o conteúdo dos arquivos coletados
  appendFileContents();

  // Determina o nome do arquivo de saída
  const outputFilename = getOutputFilename();

  // Escreve todo o conteúdo (diagrama + conteúdo dos arquivos) no arquivo de saída
  try {
    fs.writeFileSync(
      path.join(CURRENT_DIR, outputFilename),
      diagramContent + fileContents,
      'utf8',
    );
    console.log(`\nArquivo '${outputFilename}' gerado com sucesso na pasta atual.`);
    console.log(
      'Lembre-se de apagar este arquivo quando terminar de usá-lo ou adicioná-lo ao seu .gitignore!',
    );
  } catch (error) {
    console.error(`Erro ao escrever no arquivo ${outputFilename}:`, error);
  }
}

// Chama a função principal para iniciar o processo
main();