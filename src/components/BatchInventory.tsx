import { useState, useEffect, useRef, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/components/ui/use-toast";
import { Package, Plus, Layers, Edit, AlertTriangle, TrendingDown, ChevronDown, ChevronRight } from "lucide-react";

interface Product {
  id: string;
  name: string;
  current_stock: number;
  cogs: number;
}

interface InventoryBatch {
  id: string;
  product_id: string;
  product_name: string;
  quantity: number;
  remaining_quantity: number;
  cogs: number;
  batch_datetime: string;
  created_at: string;
  batch_number?: number;
}

interface GroupedBatches {
  [productName: string]: InventoryBatch[];
}

let __batchInventoryMountCount = 0; // dev-only diagnostic

export function BatchInventory() {
  console.log('BatchInventory render');
  if (import.meta.env.DEV) {
    __batchInventoryMountCount += 1;
    if (__batchInventoryMountCount > 1) {
      console.warn('BatchInventory mounted more than once. Check for duplicate usage.');
    }
  }

  const [products, setProducts] = useState<Product[]>([]);
  const [batches, setBatches] = useState<InventoryBatch[]>([]);
  const [isAddBatchOpen, setIsAddBatchOpen] = useState(false);
  const [formData, setFormData] = useState({
    quantity: '',
    cogs: '',
  });
  const [productNameInput, setProductNameInput] = useState('');
  const [editingBatch, setEditingBatch] = useState<InventoryBatch | null>(null);
  const [isEditBatchOpen, setIsEditBatchOpen] = useState(false);
  const [batchForm, setBatchForm] = useState({
    product_name: '',
    quantity: '',
    cogs: '',
    remaining_quantity: '' // Add this new field
  });
  const [expandedProducts, setExpandedProducts] = useState<Set<string>>(new Set());
  const mountedRef = useRef(false);
  const { toast } = useToast();

  useEffect(() => {
    if (mountedRef.current) return;
    mountedRef.current = true;
    fetchProducts();
    fetchBatches();
  }, []);

  // Group batches by product name
  const groupedBatches = useMemo(() => {
    const grouped: GroupedBatches = {};
    batches.forEach(batch => {
      if (!grouped[batch.product_name]) {
        grouped[batch.product_name] = [];
      }
      grouped[batch.product_name].push(batch);
    });
    
    // Sort each product's batches by batch number (ascending)
    Object.keys(grouped).forEach(productName => {
      grouped[productName].sort((a, b) => {
        const batchNumA = a.batch_number ?? 0;
        const batchNumB = b.batch_number ?? 0;
        return batchNumA - batchNumB;
      });
    });
    
    return grouped;
  }, [batches]);

  const fetchProducts = async () => {
    const { data, error } = await supabase
      .from('products')
      .select('*')
      .order('name');

    if (error) {
      toast({
        title: "Error",
        description: "Failed to fetch products",
        variant: "destructive",
      });
    } else {
      setProducts(data || []);
    }
  };

  const fetchBatches = async () => {
    const { data, error } = await supabase
      .from('inventory_batches')
      .select(`
        id,
        product_id,
        quantity,
        remaining_quantity,
        cogs,
        batch_datetime,
        created_at,
        batch_number,
        products(name)
      `)
      .order('batch_number', { ascending: true });

    if (error) {
      toast({
        title: "Error",
        description: "Failed to fetch inventory batches",
        variant: "destructive",
      });
    } else {
      const mappedBatches = (data || []).map((batch: any) => ({
        ...batch,
        product_name: batch.products.name
      }));
      setBatches(mappedBatches);
      
      // Expand all products initially or keep previous expanded state
      if (expandedProducts.size === 0) {
        const uniqueProductNames = [...new Set(mappedBatches.map(b => b.product_name))];
        setExpandedProducts(new Set(uniqueProductNames));
      }
    }
  };

  const toggleProductExpansion = (productName: string) => {
    const newExpandedProducts = new Set(expandedProducts);
    if (newExpandedProducts.has(productName)) {
      newExpandedProducts.delete(productName);
    } else {
      newExpandedProducts.add(productName);
    }
    setExpandedProducts(newExpandedProducts);
  };

  // Compute low & out-of-stock like Inventory.tsx (product-level)
  const lowStockProducts = products.filter(p => p.current_stock > 0 && p.current_stock < 10);
  const outOfStockProducts = products.filter(p => p.current_stock === 0);

  // ADD BATCH USING TYPED PRODUCT NAME
  const handleAddBatch = async () => {
    if (!productNameInput.trim() || !formData.quantity || !formData.cogs) {
      toast({
        title: "Error",
        description: "Please fill in all fields",
        variant: "destructive",
      });
      return;
    }
    // Find product by name (case-insensitive)
    const { data: product, error: findErr } = await supabase
      .from('products')
      .select('id')
      .ilike('name', productNameInput.trim())
      .maybeSingle();

    if (findErr || !product) {
      toast({
        title: "Error",
        description: "Product name not found",
        variant: "destructive",
      });
      return;
    }

    try {
      const { error } = await supabase.rpc('add_inventory_batch', {
        p_product_id: product.id,
        p_quantity: parseInt(formData.quantity),
        p_cogs: parseFloat(formData.cogs)
      });
      if (error) throw error;

      toast({ title: "Success", description: "Inventory batch added" });
      setIsAddBatchOpen(false);
      setProductNameInput('');
      setFormData({ quantity: '', cogs: '' });
      fetchProducts();
      fetchBatches();
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to add inventory batch",
        variant: "destructive",
      });
    }
  };

  // EDIT BATCH
  const openEditBatch = (batch: InventoryBatch) => {
    setEditingBatch(batch);
    setBatchForm({
      product_name: batch.product_name,
      quantity: batch.quantity.toString(),
      cogs: batch.cogs.toString(),
      remaining_quantity: batch.remaining_quantity.toString() // Include this field
    });
    setIsEditBatchOpen(true);
  };

  const handleUpdateBatch = async () => {
    if (!editingBatch) return;
    const newQty = parseInt(batchForm.quantity);
    const newRemaining = parseInt(batchForm.remaining_quantity);
    const newCogs = parseFloat(batchForm.cogs);

    if (isNaN(newQty) || isNaN(newRemaining) || isNaN(newCogs) || newQty <= 0) {
      toast({ title: "Error", description: "Invalid quantity or cogs", variant: "destructive" });
      return;
    }

    // Validate remaining quantity
    if (newRemaining > newQty) {
      toast({ 
        title: "Error", 
        description: "Remaining quantity cannot exceed original quantity", 
        variant: "destructive" 
      });
      return;
    }

    if (newRemaining < 0) {
      toast({ 
        title: "Error", 
        description: "Remaining quantity cannot be negative", 
        variant: "destructive" 
      });
      return;
    }

    // If product name changed, update product (renames globally)
    if (batchForm.product_name.trim() && batchForm.product_name.trim() !== editingBatch.product_name) {
      const { error: prodErr } = await supabase
        .from('products')
        .update({ name: batchForm.product_name.trim() })
        .eq('id', editingBatch.product_id);
      if (prodErr) {
        toast({ title: "Error", description: "Failed to rename product", variant: "destructive" });
        return;
      }
    }

    // Update both quantity and remaining_quantity directly
    const { error: batchErr } = await supabase
      .from('inventory_batches')
      .update({
        quantity: newQty,
        remaining_quantity: newRemaining,
        cogs: newCogs
      })
      .eq('id', editingBatch.id);

    if (batchErr) {
      toast({ title: "Error", description: "Failed to update batch", variant: "destructive" });
      return;
    }

    toast({ title: "Success", description: "Batch updated" });
    setIsEditBatchOpen(false);
    setEditingBatch(null);
    fetchProducts();
    fetchBatches();
  };

  const renderBatchStatus = (remaining: number, original: number) => {
    const percentage = (remaining / original) * 100;
    if (percentage === 0) {
      return <Badge className="bg-red-100 text-red-800">Depleted</Badge>;
    } else if (percentage < 25) {
      return <Badge className="bg-orange-100 text-orange-800">Low</Badge>;
    } else if (percentage < 75) {
      return <Badge className="bg-yellow-100 text-yellow-800">Partial</Badge>;
    } else {
      return <Badge className="bg-green-100 text-green-800">Full</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Batch Inventory Management</h2>
          <p className="text-muted-foreground">FIFO batch tracking system</p>
        </div>
        <Button onClick={() => setIsAddBatchOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Add Batch
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Batches</CardTitle>
            <Layers className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{batches.length}</div>
            <p className="text-xs text-muted-foreground">
              {batches.filter(b => b.remaining_quantity > 0).length} active
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Inventory Value</CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              PKR {batches.reduce((s, b) => s + b.remaining_quantity * b.cogs, 0).toLocaleString()}
            </div>
            <p className="text-xs text-muted-foreground">Remaining COGS value</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Low Stock Alert</CardTitle>
            <AlertTriangle className="h-4 w-4 text-yellow-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-yellow-600">{lowStockProducts.length}</div>
            <p className="text-xs text-muted-foreground">Products below 10 units</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Out of Stock</CardTitle>
            <TrendingDown className="h-4 w-4 text-red-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">{outOfStockProducts.length}</div>
            <p className="text-xs text-muted-foreground">Products with 0 stock</p>
          </CardContent>
        </Card>
      </div>

      {/* Product-grouped Batches Tables */}
      <Card>
        <CardHeader>
          <CardTitle>Inventory Batches by Product</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-6">
            {Object.keys(groupedBatches).length > 0 ? (
              Object.keys(groupedBatches).sort().map(productName => (
                <div key={productName} className="border rounded-lg overflow-hidden">
                  <div 
                    className="bg-muted px-4 py-3 flex items-center justify-between cursor-pointer"
                    onClick={() => toggleProductExpansion(productName)}
                  >
                    <h3 className="text-lg font-semibold flex items-center gap-2">
                      {expandedProducts.has(productName) ? (
                        <ChevronDown className="h-5 w-5" />
                      ) : (
                        <ChevronRight className="h-5 w-5" />
                      )}
                      {productName}
                    </h3>
                    <div className="text-sm text-muted-foreground">
                      {groupedBatches[productName].length} batches | 
                      {" "}
                      {groupedBatches[productName].reduce((sum, b) => sum + b.remaining_quantity, 0)} units remaining
                    </div>
                  </div>
                  
                  {expandedProducts.has(productName) && (
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Batch #</TableHead>
                            <TableHead>Original Qty</TableHead>
                            <TableHead>Remaining Qty</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>COGS</TableHead>
                            <TableHead>Remaining Value</TableHead>
                            <TableHead>Batch Date</TableHead>
                            <TableHead>Actions</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {groupedBatches[productName].map((batch) => (
                            <TableRow key={batch.id}>
                              <TableCell className="font-semibold">#{batch.batch_number ?? '-'}</TableCell>
                              <TableCell>{batch.quantity}</TableCell>
                              <TableCell className="font-semibold">{batch.remaining_quantity}</TableCell>
                              <TableCell>
                                {renderBatchStatus(batch.remaining_quantity, batch.quantity)}
                              </TableCell>
                              <TableCell>PKR {batch.cogs.toLocaleString()}</TableCell>
                              <TableCell>PKR {(batch.remaining_quantity * batch.cogs).toLocaleString()}</TableCell>
                              <TableCell className="text-muted-foreground">
                                {new Date(batch.batch_datetime).toLocaleDateString()}
                              </TableCell>
                              <TableCell>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => openEditBatch(batch)}
                                  className="flex items-center gap-1"
                                >
                                  <Edit className="h-3 w-3" /> Edit
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </div>
              ))
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                No batches found
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Add Batch Dialog */}
      <Dialog open={isAddBatchOpen} onOpenChange={setIsAddBatchOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add New Inventory Batch</DialogTitle>
            <DialogDescription>Type product name to add a batch</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="product_name">Product Name</Label>
              <Input
                id="product_name"
                value={productNameInput}
                onChange={(e) => setProductNameInput(e.target.value)}
                placeholder="Exact product name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="quantity">Quantity</Label>
              <Input
                id="quantity"
                type="number"
                min="1"
                value={formData.quantity}
                onChange={(e) => setFormData({ ...formData, quantity: e.target.value })}
                placeholder="Enter quantity"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cogs">COGS (PKR)</Label>
              <Input
                id="cogs"
                type="number"
                min="0"
                step="0.01"
                value={formData.cogs}
                onChange={(e) => setFormData({ ...formData, cogs: e.target.value })}
                placeholder="Enter COGS per unit"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setIsAddBatchOpen(false)}>Cancel</Button>
              <Button onClick={handleAddBatch}>Add Batch</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Batch Dialog */}
      <Dialog open={isEditBatchOpen} onOpenChange={setIsEditBatchOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Batch #{editingBatch?.batch_number}</DialogTitle>
            <DialogDescription>
              Update batch details (date/time unchanged)
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Product Name</Label>
              <Input
                value={batchForm.product_name}
                onChange={(e) => setBatchForm({ ...batchForm, product_name: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Original Quantity</Label>
              <Input
                type="number"
                min="1"
                value={batchForm.quantity}
                onChange={(e) => setBatchForm({ ...batchForm, quantity: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Remaining Quantity</Label>
              <Input
                type="number"
                min="0"
                max={batchForm.quantity}
                value={batchForm.remaining_quantity}
                onChange={(e) => setBatchForm({ ...batchForm, remaining_quantity: e.target.value })}
              />
              {editingBatch && (
                <p className="text-xs text-muted-foreground">
                  Consumed: {editingBatch.quantity - editingBatch.remaining_quantity} | Original: {editingBatch.quantity}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label>COGS (PKR)</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={batchForm.cogs}
                onChange={(e) => setBatchForm({ ...batchForm, cogs: e.target.value })}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setIsEditBatchOpen(false)}>Cancel</Button>
              <Button onClick={handleUpdateBatch}>Update Batch</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}