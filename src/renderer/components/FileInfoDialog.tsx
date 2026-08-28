import * as Dialog from '@radix-ui/react-dialog';
import { FileText, X } from 'lucide-react';
import type { TurnFileChange } from '../../shared/types';

interface FileInfoDialogProps {
  file: TurnFileChange | null;
  onOpenChange(open: boolean): void;
}

export function FileInfoDialog({ file, onOpenChange }: FileInfoDialogProps) {
  return (
    <Dialog.Root open={Boolean(file)} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content file-info-dialog">
          <div className="dialog-heading file-info-heading">
            <span className="file-info-heading-icon"><FileText size={18} /></span>
            <div>
              <Dialog.Title>{file ? baseName(file.path) : '文件信息'}</Dialog.Title>
              <Dialog.Description>本轮文件变更的基础信息</Dialog.Description>
            </div>
            <Dialog.Close className="icon-button" aria-label="关闭文件信息">
              <X size={16} />
            </Dialog.Close>
          </div>
          {file && (
            <dl className="file-info-fields">
              <div><dt>文件名</dt><dd>{baseName(file.path)}</dd></div>
              <div><dt>相对路径</dt><dd title={file.path}>{file.path}</dd></div>
              <div><dt>文件类型</dt><dd>{fileTypeLabel(file)}</dd></div>
              <div><dt>变更类型</dt><dd>{changeLabel(file.kind)}</dd></div>
              <div><dt>文件大小</dt><dd>{file.size === null ? '—' : formatBytes(file.size)}</dd></div>
              <div><dt>创建时间</dt><dd>{formatDate(file.createdAt)}</dd></div>
              <div><dt>修改时间</dt><dd>{formatDate(file.modifiedAt)}</dd></div>
            </dl>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function fileTypeLabel(file: TurnFileChange): string {
  const name = baseName(file.path);
  const dot = name.lastIndexOf('.');
  const extension = dot > 0 ? name.slice(dot + 1).toUpperCase() : '';
  if (extension) return `${extension} 文件`;
  return file.binary ? '二进制文件' : '无扩展名文件';
}

function baseName(filePath: string): string {
  return filePath.split(/[\\/]/).at(-1) ?? filePath;
}

function changeLabel(kind: TurnFileChange['kind']): string {
  return { created: '新增', modified: '修改', deleted: '删除' }[kind];
}

function formatDate(value: number | null): string {
  return value === null ? '—' : new Date(value).toLocaleString('zh-CN');
}

function formatBytes(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1_024).toFixed(1)} KB`;
  if (bytes < 1_073_741_824) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
}
