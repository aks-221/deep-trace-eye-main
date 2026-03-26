-- Create dossier_documents table
CREATE TABLE public.dossier_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dossier_id UUID NOT NULL REFERENCES public.investigation_dossiers(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_size INTEGER DEFAULT 0,
  file_type TEXT DEFAULT 'application/octet-stream',
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.dossier_documents ENABLE ROW LEVEL SECURITY;

-- RLS: view docs if can view the dossier
CREATE POLICY "Users can view dossier documents"
ON public.dossier_documents FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.investigation_dossiers d
    WHERE d.id = dossier_documents.dossier_id
    AND (d.user_id = auth.uid() OR has_role(auth.uid(), 'superadmin') OR has_role(auth.uid(), 'org_admin') OR has_role(auth.uid(), 'analyst') OR has_role(auth.uid(), 'forensic_analyst'))
  )
);

-- RLS: insert docs
CREATE POLICY "Users can upload dossier documents"
ON public.dossier_documents FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = user_id
  AND EXISTS (
    SELECT 1 FROM public.investigation_dossiers d
    WHERE d.id = dossier_documents.dossier_id
    AND (d.user_id = auth.uid() OR has_role(auth.uid(), 'superadmin') OR has_role(auth.uid(), 'org_admin') OR has_role(auth.uid(), 'analyst') OR has_role(auth.uid(), 'forensic_analyst'))
  )
);

-- RLS: delete own docs
CREATE POLICY "Users can delete own dossier documents"
ON public.dossier_documents FOR DELETE
TO authenticated
USING (auth.uid() = user_id OR has_role(auth.uid(), 'superadmin'));

-- Create storage bucket for dossier documents
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('dossier-documents', 'dossier-documents', false, 20971520);

-- Storage RLS: authenticated users can upload
CREATE POLICY "Authenticated users can upload dossier docs"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'dossier-documents');

-- Storage RLS: authenticated users can read
CREATE POLICY "Authenticated users can read dossier docs"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'dossier-documents');

-- Storage RLS: users can delete own uploads
CREATE POLICY "Users can delete own dossier docs"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'dossier-documents' AND (storage.foldername(name))[1] = auth.uid()::text);