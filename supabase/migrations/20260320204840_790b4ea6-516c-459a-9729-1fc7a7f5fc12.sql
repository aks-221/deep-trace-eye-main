-- Allow authenticated users to see all profile names for @mentions
CREATE POLICY "Authenticated users can view all profiles for mentions"
ON public.profiles
FOR SELECT
TO authenticated
USING (true);