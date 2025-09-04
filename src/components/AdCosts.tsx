import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/components/ui/use-toast";
import { Plus, TrendingUp } from "lucide-react";

interface AdCost {
  id: string;
  date: string;
  platform: string;
  amount: number;
  created_at: string;
}

export function AdCosts() {
  const [adCosts, setAdCosts] = useState<AdCost[]>([]);
  const [selectedMonth, setSelectedMonth] = useState(new Date().toISOString().slice(0, 7));
  const [formData, setFormData] = useState({
    date: new Date().toISOString().split('T')[0],
    platform: '',
    amount: '',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    fetchAdCosts();
  }, [selectedMonth]);

  const fetchAdCosts = async () => {
    setIsLoading(true);
    const startDate = `${selectedMonth}-01`;
    
    // Calculate the last day of the month correctly
    const year = parseInt(selectedMonth.substring(0, 4));
    const month = parseInt(selectedMonth.substring(5, 7));
    const lastDay = new Date(year, month, 0).getDate();
    const endDate = `${selectedMonth}-${lastDay}`;

    try {
      const { data, error } = await supabase
        .from('ad_costs')
        .select('*')
        .gte('date', startDate)
        .lte('date', endDate)
        .order('date', { ascending: false });

      if (error) throw error;
      
      // No error throwing when data is empty, just set empty array
      setAdCosts(data || []);
    } catch (error) {
      console.error("Error fetching ad costs:", error);
      toast({
        title: "Error",
        description: "Failed to fetch ad costs",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.platform || !formData.amount) {
      toast({
        title: "Error",
        description: "Please fill in all fields",
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);

    try {
      const { error } = await supabase
        .from('ad_costs')
        .insert([
          {
            date: formData.date,
            platform: formData.platform,
            amount: parseFloat(formData.amount),
          },
        ]);

      if (error) throw error;

      toast({
        title: "Success",
        description: "Ad cost added successfully",
      });

      // Reset form
      setFormData({
        date: new Date().toISOString().split('T')[0],
        platform: '',
        amount: '',
      });

      // Refresh data
      fetchAdCosts();
    } catch (error) {
      console.error("Error adding ad cost:", error);
      toast({
        title: "Error",
        description: "Failed to add ad cost",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const getPlatformBadge = (platform: string) => {
    const platformColors = {
      Meta: "bg-blue-100 text-blue-800 hover:bg-blue-100",
      Google: "bg-green-100 text-green-800 hover:bg-green-100",
      TikTok: "bg-pink-100 text-pink-800 hover:bg-pink-100",
      Facebook: "bg-blue-100 text-blue-800 hover:bg-blue-100",
      Instagram: "bg-purple-100 text-purple-800 hover:bg-purple-100",
    };
    
    return (
      <Badge className={platformColors[platform as keyof typeof platformColors] || "bg-gray-100 text-gray-800"}>
        {platform}
      </Badge>
    );
  };

  const totalAdSpend = adCosts.reduce((sum, cost) => sum + cost.amount, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold">Ad Cost Tracking</h2>
          <p className="text-muted-foreground">Log and track advertising expenses across platforms</p>
        </div>
        <div className="w-full md:w-auto mt-2 md:mt-0">
          <Select value={selectedMonth} onValueChange={setSelectedMonth}>
            <SelectTrigger className="w-full md:w-48">
              <SelectValue placeholder="Select month" />
            </SelectTrigger>
            <SelectContent>
              {Array.from({ length: 12 }, (_, i) => {
                const date = new Date();
                date.setMonth(date.getMonth() - i);
                const value = date.toISOString().slice(0, 7);
                const label = date.toLocaleDateString('en-US', { year: 'numeric', month: 'long' });
                return (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Monthly Summary */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Total Ad Spend</CardTitle>
          <TrendingUp className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">PKR {totalAdSpend.toLocaleString()}</div>
          <p className="text-xs text-muted-foreground">
            For {new Date(selectedMonth + "-01").toLocaleDateString('en-US', { year: 'numeric', month: 'long' })}
          </p>
        </CardContent>
      </Card>

      {/* Add New Ad Cost */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Plus className="h-5 w-5" />
            Add New Ad Cost
          </CardTitle>
          <CardDescription>
            Log advertising charges from platforms like Meta, Google, TikTok, etc.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="date">Date</Label>
                <Input
                  id="date"
                  type="date"
                  value={formData.date}
                  onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                  required
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="platform">Platform</Label>
                <Select value={formData.platform} onValueChange={(value) => setFormData({ ...formData, platform: value })}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select platform" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Meta">Meta</SelectItem>
                    <SelectItem value="Google">Google</SelectItem>
                    <SelectItem value="TikTok">TikTok</SelectItem>
                    <SelectItem value="Facebook">Facebook</SelectItem>
                    <SelectItem value="Instagram">Instagram</SelectItem>
                    <SelectItem value="YouTube">YouTube</SelectItem>
                    <SelectItem value="Other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="amount">Amount (PKR)</Label>
                <Input
                  id="amount"
                  type="number"
                  step="0.01"
                  placeholder="Enter amount"
                  value={formData.amount}
                  onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                  required
                />
              </div>
            </div>
            
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Adding..." : "Add Ad Cost"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Ad Costs Table */}
      <Card>
        <CardHeader>
          <CardTitle>
            Ad Costs for {new Date(selectedMonth + "-01").toLocaleDateString('en-US', { year: 'numeric', month: 'long' })}
          </CardTitle>
          <CardDescription>
            {adCosts.length} entries found
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">
              Loading ad costs...
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Platform</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Added On</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {adCosts.map((cost) => (
                    <TableRow key={cost.id}>
                      <TableCell>{new Date(cost.date).toLocaleDateString()}</TableCell>
                      <TableCell>{getPlatformBadge(cost.platform)}</TableCell>
                      <TableCell className="font-medium">PKR {cost.amount.toLocaleString()}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {new Date(cost.created_at).toLocaleDateString()}
                      </TableCell>
                    </TableRow>
                  ))}
                  {adCosts.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center py-4 text-muted-foreground">
                        No ad costs found for this month
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}