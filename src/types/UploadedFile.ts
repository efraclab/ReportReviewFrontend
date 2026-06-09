export interface UploadedFile {
    id: string;
    file: File;
    name: string;
    size: number;
    objectUrl?: string;
}
