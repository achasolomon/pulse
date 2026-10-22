import { BadRequestException } from '@nestjs/common';
import type {StaffNoteDraftContent} from '@pulse/api-contracts';
import {validNoteDocument,noteDocumentText} from '@pulse/api-contracts/note-rich-text';
export function validateNoteFormatting(input:StaffNoteDraftContent) {
  if(input.richText===undefined)return;
  if(!input.richText||typeof input.richText!=='object'||Array.isArray(input.richText)||JSON.stringify(input.richText).length>60000)throw new BadRequestException('Invalid note formatting');
  for(const [key,document] of Object.entries(input.richText)){
    if(!['history','examination','assessment','plan'].includes(key)||!validNoteDocument(document)||noteDocumentText(document)!==input[key as 'history'])throw new BadRequestException('Note formatting must match the saved narrative');
  }
}
