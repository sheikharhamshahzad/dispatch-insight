import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/components/ui/use-toast";
import { Plus, Package2, Trash2 } from "lucide-react";
import { 
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface PackagingCost {
  id: string;
  date: string;
  description: string;
  amount: number;
  created_at: string;
}

export function Packaging() {
  const [packagingCosts, setPackagingCosts] = useState<PackagingCost[]>([]);
  const [selectedMonth, setSelectedMonth] = useState(new Date().toISOString().slice(0, 7));
  const [formData, setFormData] = useState({
    date: new Date().toISOString().split('T')[0],
    description: '',
    amount: '',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [costToDelete, setCostToDelete] = useState<PackagingCost | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    fetchPackagingCosts();
  }, [selectedMonth]);

  const fetchPackagingCosts = async () => {
    setIsLoading(true);
    const startDate = `${selectedMonth}-01`;
    
    // Calculate the correct last day of the month
    const lastDay = new Date(parseInt(selectedMonth.split('-')[0]), parseInt(selectedMonth.split('-')[1]), 0).getDate();
    const endDate = `${selectedMonth}-${lastDay}`;

    try {
      const { data, error } = await supabase
        .from('packaging_costs')
        .select('*')
        .gte('date', startDate)
        .lte('date', endDate)
        .order('date', { ascending: false });

      if (error) throw error;
      
      setPackagingCosts(data || []);
    } catch (error) {
      console.error("Error fetching packaging costs:", error);
      toast({
        title: "Error",
        description: "Failed to fetch packaging costs. Please try again later.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.description || !formData.amount) {
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
        .from('packaging_costs')
        .insert([
          {
            date: formData.date,
            description: formData.description,
            amount: parseFloat(formData.amount),
          },
        ]);

      if (error) throw error;

      toast({
        title: "Success",
        description: "Packaging cost added successfully",
      });

      // Reset form
      setFormData({
        date: new Date().toISOString().split('T')[0],
        description: '',
        amount: '',
      });

      // Refresh data
      fetchPackagingCosts();
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to add packaging cost",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const openDeleteConfirm = (cost: PackagingCost) => {
    setCostToDelete(cost);
    setDeleteConfirmOpen(true);
  };

  const handleDeleteCost = async () => {
    if (!costToDelete) return;
    
    try {
      const { error } = await supabase
        .from('packaging_costs')
        .delete()
        .eq('id', costToDelete.id);

      if (error) throw error;

      toast({
        title: "Success",
        description: "Packaging cost deleted successfully",
      });

      setDeleteConfirmOpen(false);
      fetchPackagingCosts();
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to delete packaging cost",
        variant: "destructive",
      });
    }
  };

  const totalPackagingCost = packagingCosts.reduce((sum, cost) => sum + cost.amount, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold">Packaging Costs</h2>
          <p className="text-muted-foreground">
            Track expenses for boxes, tape, bubble wrap, and other packaging materials
          </p>
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
          <CardTitle className="text-sm font-medium">Total Packaging Expenses</CardTitle>
          <Package2 className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center h-12">
              <p className="text-sm text-muted-foreground">Loading...</p>
            </div>
          ) : (
            <>
              <div className="text-2xl font-bold">PKR {totalPackagingCost.toLocaleString()}</div>
              <p className="text-xs text-muted-foreground">
                For {new Date(selectedMonth).toLocaleDateString('en-US', { year: 'numeric', month: 'long' })}
              </p>
            </>
          )}
        </CardContent>
      </Card>

      {/* Add New Packaging Cost */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Plus className="h-5 w-5" />
            Add Packaging Expense
          </CardTitle>
          <CardDescription>
            Record costs for boxes, tape, bubble wrap, and other packaging materials
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="date">Date of Purchase</Label>
                <Input
                  id="date"
                  type="date"
                  value={formData.date}
                  onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                  required
                />
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
            
            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                placeholder="Describe what packaging materials were purchased..."
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                className="min-h-[100px]"
                required
              />
            </div>
            
            <Button type="submit" disabled={isSubmitting} className="w-full md:w-auto">
              {isSubmitting ? "Adding..." : "Add Packaging Cost"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Packaging Costs Table */}
      <Card>
        <CardHeader>
          <CardTitle>
            Packaging Costs for {new Date(selectedMonth).toLocaleDateString('en-US', { year: 'numeric', month: 'long' })}
          </CardTitle>
          <CardDescription>
            {isLoading ? "Loading..." : `${packagingCosts.length} entries found`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <p className="text-muted-foreground">Loading packaging costs...</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Added On</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {packagingCosts.map((cost) => (
                    <TableRow key={cost.id}>
                      <TableCell>{new Date(cost.date).toLocaleDateString()}</TableCell>
                      <TableCell className="max-w-md">
                        <div className="truncate">{cost.description}</div>
                      </TableCell>
                      <TableCell className="font-medium">PKR {cost.amount.toLocaleString()}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {new Date(cost.created_at).toLocaleDateString()}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openDeleteConfirm(cost)}
                        >
                          <Trash2 className="h-4 w-4 text-red-500" />
                          <span className="sr-only">Delete</span>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          
          {!isLoading && packagingCosts.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              No packaging costs found for this month
            </div>
          )}
        </CardContent>
      </Card>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Packaging Cost Entry</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this packaging cost entry? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          
          {costToDelete && (
            <div className="grid gap-4 py-4">
              <div className="grid grid-cols-4 items-center gap-4">
                <Label className="text-right">Date:</Label>
                <div className="col-span-3">{new Date(costToDelete.date).toLocaleDateString()}</div>
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label className="text-right">Amount:</Label>
                <div className="col-span-3">PKR {costToDelete.amount.toLocaleString()}</div>
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label className="text-right">Description:</Label>
                <div className="col-span-3">{costToDelete.description}</div>
              </div>
            </div>
          )}
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirmOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDeleteCost}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}