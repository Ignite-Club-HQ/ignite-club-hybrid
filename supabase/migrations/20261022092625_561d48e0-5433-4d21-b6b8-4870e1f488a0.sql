CREATE POLICY "Club media writes go through measured upload"
ON storage.objects AS RESTRICTIVE FOR INSERT TO anon, authenticated
WITH CHECK (NOT (bucket_id IN ('photos','chat-attachments','competition-vault') AND (storage.foldername(name))[1] = 'clubs'));

CREATE POLICY "Club media updates go through measured upload"
ON storage.objects AS RESTRICTIVE FOR UPDATE TO anon, authenticated
USING (NOT (bucket_id IN ('photos','chat-attachments','competition-vault') AND (storage.foldername(name))[1] = 'clubs'))
WITH CHECK (NOT (bucket_id IN ('photos','chat-attachments','competition-vault') AND (storage.foldername(name))[1] = 'clubs'));