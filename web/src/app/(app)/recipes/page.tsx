import { redirect } from 'next/navigation';

/** Legacy path — recipes now live under Runway → Recipes */
export default function ContentRecipesPage() {
  redirect('/runway?section=recipes');
}
